import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { contextSettings, createContextExtension, createProjectMemory, historyItems, recoveryContext, redactContext, taskNotes } from "./context-memory.mjs";

// 使用真实 Pi 会话和扩展运行器验证持久化，不发起模型请求，也不读取个人凭据。
async function fixture(t, preferences = {}) {
  const root = await mkdtemp(join(tmpdir(), "plc-context-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "project");
  await mkdir(cwd);
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
  const store = await createProjectMemory(join(root, "memories"), cwd, ["test-private-credential"]);
  const sessionManager = SessionManager.create(cwd, join(root, "sessions"));
  const loader = new DefaultResourceLoader({ cwd, agentDir: join(root, "agent"), noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, extensionFactories: [createContextExtension({ store, preferences, secrets: ["test-private-credential"], runtime })] });
  await loader.reload();
  const { session, extensionsResult } = await createAgentSession({ cwd, agentDir: join(root, "agent"), modelRuntime: runtime, sessionManager, resourceLoader: loader, settingsManager: SettingsManager.inMemory({ compaction: contextSettings(128000) }), tools: ["notes", "history", ...(preferences.project_memory === false ? [] : ["memory"])] });
  assert.equal(extensionsResult.errors.length, 0);
  t.after(() => session.dispose());
  const userId = sessionManager.appendMessage({ role: "user", content: "检查工程 A，写回前必须审批。", timestamp: Date.now() });
  sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: "先读取工程，不执行写入。" }], api: "openai-responses", provider: "openai", model: "gpt-4.1", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
  async function call(name, args, signal = new AbortController().signal) {
    const tool = session.agent.state.tools.find((tool) => tool.name === name);
    assert.ok(tool, `工具 ${name} 已在真实 Agent 注册`);
    const result = await tool.execute(`call-${Date.now()}`, args, signal);
    return JSON.parse(result.content[0].text);
  }
  return { root, cwd, store, session, sessionManager, call, userId };
}

test("笔记写入、追加、分页读取，重启后保留且不进入普通消息正文", async (t) => {
  const { call, sessionManager, cwd } = await fixture(t);
  await call("notes", { action: "write", path: "checkpoint.md", content: "已读工程；下一步：等审批。" });
  await call("notes", { action: "append", path: "checkpoint.md", content: "不得重复写入。" });
  const read = await call("notes", { action: "read", path: "checkpoint.md", limit: 5 });
  assert.equal(read.text.length, 5);
  assert.equal(read.next_offset, 5);
  const restored = SessionManager.open(sessionManager.getSessionFile(), undefined, cwd);
  assert.match(taskNotes(restored).get("checkpoint.md").content, /不得重复/);
  assert.equal(restored.buildSessionContext().messages.some((message) => JSON.stringify(message).includes("不得重复写入")), false);
});

test("撤回、分支恢复使用当前分支，不带入未来笔记", async (t) => {
  const { call, sessionManager } = await fixture(t);
  await call("notes", { action: "write", content: "第一阶段" });
  const first = sessionManager.getLeafId();
  await call("notes", { action: "write", content: "第二阶段" });
  sessionManager.branch(first);
  assert.equal(taskNotes(sessionManager).get("checkpoint.md").content, "第一阶段");
  await call("notes", { action: "delete" });
  assert.equal(taskNotes(sessionManager).size, 0);
});

test("笔记拒绝路径穿越、绝对路径、超长正文与已中止调用", async (t) => {
  const { call } = await fixture(t);
  for (const path of ["../secret.md", "C:/private.md", "a\\b.md", "a/../../b.md", "/root.md"]) {
    await assert.rejects(call("notes", { action: "write", path, content: "内容" }), /相对笔记名/);
  }
  await assert.rejects(call("notes", { action: "write", content: "x".repeat(24001) }), /24000/);
  await assert.rejects(call("notes", { action: "write", content: "中止" }, AbortSignal.abort()));
  assert.deepEqual(await call("notes", { action: "list" }), []);
});

test("压缩后仍能检索原始记录、分页和窗口，不泄漏推理与图片", async (t) => {
  const { call, sessionManager, userId } = await fixture(t);
  sessionManager.appendMessage({ role: "toolResult", toolCallId: "read-a", toolName: "read", content: [{ type: "text", text: "文件 A 校验信息 test-private-credential" }, { type: "thinking", thinking: "内部推理不可索引" }, { type: "image", data: "图片不可索引", mimeType: "image/png" }], isError: false, timestamp: Date.now() });
  const kept = sessionManager.appendMessage({ role: "user", content: "第二轮要求", timestamp: Date.now() });
  sessionManager.appendCompaction("第一轮的续接摘要", kept, 20000);
  const found = await call("history", { action: "search", query: "工程 A" });
  assert.equal(found.items[0].id, userId);
  const read = await call("history", { action: "read", id: userId, limit: 3 });
  assert.equal(read.next_offset, 3);
  const windows = await call("history", { action: "windows" });
  assert.equal(windows.length, 2);
  assert.equal((await call("history", { action: "list", window_id: "unknown" })).items.length, 0);
  const text = JSON.stringify(historyItems(sessionManager, ["test-private-credential"]));
  for (const secret of ["test-private-credential", "内部推理不可索引", "图片不可索引"]) assert.equal(text.includes(secret), false);
});

test("记忆必须有来源，支持检索、忘记，同项目恢复但不同项目隔离", async (t) => {
  const { call, root, cwd, store, userId } = await fixture(t);
  await assert.rejects(call("memory", { action: "save", title: "约定", content: "写回必须审批", source_id: "invented" }), /source_id/);
  const saved = await call("memory", { action: "save", title: "工程安全约定", content: "写回必须审批", source_id: userId });
  assert.equal((await call("memory", { action: "search", query: "审批" })).items.length, 1);
  assert.equal((await call("memory", { action: "read", id: saved.id })).source.entry_id, userId);
  const reopened = await createProjectMemory(join(root, "memories"), cwd);
  assert.equal((await reopened.list()).length, 1);
  const other = join(root, "other");
  await mkdir(other);
  assert.deepEqual(await (await createProjectMemory(join(root, "memories"), other)).list(), []);
  await call("memory", { action: "delete", id: saved.id });
  assert.deepEqual(await store.list(), []);
});

test("项目并发保存不覆盖，损坏记录不阻断，凭据过滤后才落盘", async (t) => {
  const { store } = await fixture(t);
  await Promise.all(Array.from({ length: 8 }, (_, index) => store.save({ title: `约定 ${index}`, content: "api_key: abc123456 test-private-credential", source: { entry_id: "test" } })));
  assert.equal((await store.list()).length, 8);
  const file = (await readdir(store.directory))[0];
  const content = await readFile(join(store.directory, file), "utf8");
  assert.equal(content.includes("test-private-credential"), false);
  assert.equal(content.includes("abc123456"), false);
  await writeFile(join(store.directory, file), "{broken", "utf8");
  assert.equal((await store.list()).length, 7);
});

test("关闭项目记忆后工具与自动注入均禁用；短索引不注入完整记忆", async (t) => {
  const { call, sessionManager, session, store } = await fixture(t, { project_memory: false });
  assert.equal(session.agent.state.tools.some((tool) => tool.name === "memory"), false);
  await call("notes", { action: "write", content: "续接目标" });
  await store.save({ title: "项目约定", content: "不应该自动注入的长正文".repeat(100), source: {} });
  const disabled = await recoveryContext(sessionManager, store, { project_memory: false });
  assert.equal(disabled.includes("项目约定"), false);
  const enabled = await recoveryContext(sessionManager, store, {});
  assert.ok(enabled.includes("项目约定"));
  assert.equal(enabled.includes("不应该自动注入的长正文"), false);
  assert.ok(enabled.length <= 6000);
});

test("压缩预算按窗口缩放；敏感模式脱敏不破坏普通中文", () => {
  for (const window of [1024, 8192, 128000, 1000000]) {
    const settings = contextSettings(window);
    assert.ok(settings.reserveTokens + settings.keepRecentTokens < window);
  }
  assert.equal(contextSettings(128000, { auto_compact: false }).enabled, false);
  assert.equal(redactContext("工程路径与编译结果"), "工程路径与编译结果");
  assert.equal(redactContext("密码：abcd1234").includes("abcd1234"), false);
});

test("真实扩展生命周期自动记录运行位置，保存摘要且不新增模型调用", async (t) => {
  const { session, sessionManager, store } = await fixture(t);
  // 直接投递实际 SDK 事件，仅测试事件编排；模型生成另由隔离真实 API 实测覆盖。
  await session._extensionRunner.emit({ type: "turn_end", message: { stopReason: "stop" }, toolResults: [] });
  assert.ok(taskNotes(sessionManager).has("runtime.md"));
  const kept = sessionManager.appendMessage({ role: "user", content: "继续检查，仍未批准写入。", timestamp: Date.now() });
  const id = sessionManager.appendCompaction("已读取，写回待审批。下一步：等待用户批准。", kept, 20000);
  await session._extensionRunner.emit({ type: "session_compact", compactionEntry: sessionManager.getEntry(id), reason: "manual", willRetry: false });
  const records = await store.list();
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, "summary");
  assert.equal(records[0].source.entry_id, id);
  assert.match(records[0].content, /待审批/);
});

test("摘要扩展缺少有效模型时明确取消，不覆盖原会话", async (t) => {
  const { session, sessionManager } = await fixture(t);
  const before = sessionManager.getLeafId();
  const result = await session._extensionRunner.emit({ type: "session_before_compact", preparation: {}, reason: "manual", signal: AbortSignal.abort() });
  assert.equal(result.cancel, true);
  assert.equal(sessionManager.getLeafId(), before);
  assert.equal(sessionManager.getBranch().some((entry) => entry.type === "compaction"), false);
});

test("关闭自动回顾后仍保存会话笔记，转义内容也不能撑爆注入预算", async (t) => {
  const { call, session, sessionManager, store } = await fixture(t, { auto_memory: false });
  await call("notes", { action: "write", content: '\\"\n'.repeat(1000) });
  await session._extensionRunner.emit({ type: "agent_settled" });
  assert.deepEqual(await store.list(), []);
  for (const maxChars of [512, 2000, 6000]) {
    const content = await recoveryContext(sessionManager, store, {}, [], maxChars);
    assert.ok(content.length <= maxChars);
    assert.doesNotThrow(() => JSON.parse(content.split("\n")[1]));
  }
});
