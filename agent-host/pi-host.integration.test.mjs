import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

async function fixture(t, handle) {
  const root = await mkdtemp(join(tmpdir(), "plc-pi087-"));
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    try { await handle(requests, response); }
    catch (error) { response.destroy(error); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const child = spawn(process.env.PLC_PILOT_TEST_NODE || process.execPath, [resolve(process.env.PLC_PILOT_TEST_HOST_BUNDLE || "agent-host/pi-agent-host.bundle.mjs")], {
    cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PLC_PILOT_LOG_DIR: join(root, "logs"), PI_OFFLINE: "1" },
  });
  const events = [];
  let errors = "";
  child.stderr.on("data", (data) => { errors += data; });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => { try { events.push(JSON.parse(line)); } catch {} });
  const send = (value) => child.stdin.write(JSON.stringify(value) + "\n");
  async function waitFor(predicate, from = 0) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const value = events.slice(from).find(predicate);
      if (value) return value;
      if (child.exitCode !== null) throw new Error(`宿主提前退出 ${child.exitCode}: ${errors.slice(-1600)}`);
      await delay(15);
    }
    throw new Error(`等待宿主事件超时: ${JSON.stringify(events.slice(-4))} ${errors.slice(-800)}`);
  }
  t.after(async () => {
    if (child.exitCode === null) { const closed = once(child, "close"); child.kill(); await closed; }
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  });
  await waitFor((event) => event.type === "ready");
  const config = {
    type: "run", action: "prompt", request_id: "first", cwd: root, session_dir: join(root, "sessions"),
    message: "读取附件后回复", context_management: { auto_compact: false, auto_memory: false },
    model: { id: "local-test", model: "test-model", provider: "chatcompletions", base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key: "local-only", context_window: 128000, reasoning_levels: ["none"], max_tokens: 4096 },
    reasoning_effort: "none",
    retry: { max_retries: 2, base_delay_ms: 30, max_delay_ms: 50 },
    mcp_tools: [{ qualified_name: "test__inspect", server_id: "test", name: "inspect", description: "读取测试文件", input_schema: { type: "object", properties: {}, additionalProperties: false } }],
  };
  return { root, requests, events, send, waitFor, config };
}

function stream(response, delta, finish = null) {
  if (!response.headersSent) response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.write("data: " + JSON.stringify({ id: "test", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta, finish_reason: finish }] }) + "\n\n");
}

function done(response) { response.end("data: [DONE]\n\n"); }
function tool(response) {
  stream(response, { role: "assistant", tool_calls: [{ index: 0, id: "call-inspect", type: "function", function: { name: "test__inspect", arguments: "{}" } }] });
  stream(response, {}, "tool_calls");
  done(response);
}

function responseEvent(response, type, data) {
  if (!response.headersSent) response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.write("event: " + type + "\ndata: " + JSON.stringify({ type, ...data }) + "\n\n");
}

function responseTool(response, id, complete) {
  const item = { id: "fc-" + id, type: "function_call", call_id: id, name: "test__inspect", arguments: "", status: "in_progress" };
  responseEvent(response, "response.created", { response: { id: "resp-" + id, status: "in_progress", output: [] } });
  responseEvent(response, "response.output_item.added", { output_index: 0, item });
  responseEvent(response, "response.function_call_arguments.delta", { output_index: 0, item_id: item.id, delta: complete ? "{}" : '{"path":"unfinished' });
  if (!complete) return;
  item.arguments = "{}"; item.status = "completed";
  responseEvent(response, "response.output_item.done", { output_index: 0, item });
  responseEvent(response, "response.completed", { response: { id: "resp-" + id, status: "completed", output: [item], usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } } });
  response.end();
}

function responseText(response, text, complete = true) {
  const item = { id: "msg-test", type: "message", role: "assistant", status: "in_progress", content: [] };
  responseEvent(response, "response.created", { response: { id: "resp-text", status: "in_progress", output: [] } });
  responseEvent(response, "response.output_item.added", { output_index: 0, item });
  responseEvent(response, "response.content_part.added", { item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
  responseEvent(response, "response.output_text.delta", { item_id: item.id, output_index: 0, content_index: 0, delta: text });
  if (!complete) return;
  item.status = "completed"; item.content = [{ type: "output_text", text, annotations: [] }];
  responseEvent(response, "response.output_item.done", { output_index: 0, item });
  responseEvent(response, "response.completed", { response: { id: "resp-text", status: "completed", output: [item], usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } } });
  response.end();
}

test("Pi 0.87 宿主真实流式、审批等待续接、附件链接和恢复后笔记可用", async (t) => {
  let finalSent = false;
  let releaseFinal;
  const host = await fixture(t, async (requests, response) => {
    if (requests.length === 1) { tool(response); return; }
    stream(response, { role: "assistant", content: "已读取 " });
    if (requests.length === 2) await new Promise((resolve) => { releaseFinal = resolve; });
    stream(response, { content: "[表.xlsx](<C:/资料/表.xlsx>)" });
    stream(response, {}, "stop"); finalSent = true; done(response);
  });
  host.send({ ...host.config, attachments: [{ name: "表.xlsx", kind: "text", mime_type: "text/plain", text_content: "A1:100", source_path: "C:/资料/表.xlsx" }] });
  const call = await host.waitFor((event) => event.type === "tool_request");
  host.send({ type: "approval_wait", request_id: call.request_id });
  await delay(100);
  assert.equal(host.events.some((event) => event.type === "result"), false);
  host.send({ type: "tool_result", request_id: call.request_id, decision: "approved", content: [{ type: "text", text: "A1:100" }], is_error: false });
  await host.waitFor((event) => event.type === "delta");
  assert.equal(finalSent, false);
  releaseFinal();
  const result = await host.waitFor((event) => event.type === "result" || event.type === "error");
  assert.equal(result.type, "result", JSON.stringify(result));
  assert.match(result.text, /表.xlsx/);
  assert.match(JSON.stringify(host.requests[0]), /文件交付与引用约定/);
  assert.match(JSON.stringify(host.requests[0]), /markdown_link/);
  const entries = (await readFile(result.session.session_file, "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(entries.some((entry) => entry.customType === "plc-pilot.task-note" && entry.data.path === "runtime.md"));
  assert.equal(host.requests.length, 2);
  const from = host.events.length;
  host.send({ ...host.config, request_id: "resumed", session_file: result.session.session_file, message: "继续" });
  const resumed = await host.waitFor((event) => event.type === "result" || event.type === "error", from);
  assert.equal(resumed.type, "result", JSON.stringify(resumed));
  assert.equal(resumed.session.session_id, result.session.session_id);
});

test("重新生成沿用同一 JSONL 会话树，不创建新的会话文件", async (t) => {
  const host = await fixture(t, async (requests, response) => {
    const text = requests.length === 1 ? "第一版回复" : "第二版回复";
    stream(response, { role: "assistant", content: text });
    stream(response, {}, "stop");
    done(response);
  });
  host.send(host.config);
  const first = await host.waitFor((event) => event.type === "result" || event.type === "error");
  assert.equal(first.type, "result", JSON.stringify(first));
  const from = host.events.length;
  host.send({
    ...host.config,
    request_id: "retry-same-session",
    session_file: first.session.session_file,
    retry_turn_index: 0,
    message: host.config.message,
  });
  const second = await host.waitFor((event) => event.type === "result" || event.type === "error", from);
  assert.equal(second.type, "result", JSON.stringify(second));
  assert.equal(second.text, "第二版回复");
  assert.equal(second.session.session_id, first.session.session_id);
  assert.equal(second.session.session_file, first.session.session_file);
});

test("Pi edit 可读取工作目录外的附件并进入统一写入审批", async (t) => {
  let externalPath;
  const host = await fixture(t, async (requests, response) => {
    if (requests.length === 1) {
      stream(response, { role: "assistant", tool_calls: [{ index: 0, id: "external-edit", type: "function", function: { name: "edit", arguments: JSON.stringify({ path: externalPath, oldText: "before", newText: "after" }) } }] });
      stream(response, {}, "tool_calls");
      done(response);
      return;
    }
    stream(response, { role: "assistant", content: "附件修改已处理" });
    stream(response, {}, "stop");
    done(response);
  });
  const workspace = join(host.root, "workspace");
  externalPath = join(host.root, "attachment.txt");
  await mkdir(workspace);
  await writeFile(externalPath, "before");
  host.send({ ...host.config, cwd: workspace });
  const call = await host.waitFor((event) => event.type === "tool_request");
  assert.equal(call.tool_name, "propose_write");
  assert.equal(call.arguments.path, externalPath);
  assert.equal(call.arguments.expected, "before");
  assert.equal(call.arguments.content, "after");
  assert.equal(await readFile(externalPath, "utf8"), "before");
  host.send({ type: "tool_result", request_id: call.request_id, decision: "executed", content: [{ type: "text", text: "写入结果已确认" }], is_error: false });
  const result = await host.waitFor((event) => event.type === "result" || event.type === "error");
  assert.equal(result.type, "result", JSON.stringify(result));
});

test("审批后的命令使用当前系统原生命令工具执行", async (t) => {
  const host = await fixture(t, async () => { throw new Error("命令宿主不应请求模型"); });
  host.send({ type: "execute_approved", arguments: {
    cwd: host.root,
    command: process.platform === "win32" ? "Write-Output 'native-command-ok'" : "printf 'native-command-ok\\n'",
    timeout: 5,
    record_in_session: false,
  } });
  const result = await host.waitFor((event) => event.type === "result" || event.type === "error");
  assert.equal(result.type, "result", JSON.stringify(result));
  assert.equal(result.is_error, false);
  assert.match(JSON.stringify(result.content), /native-command-ok/);
  assert.equal(host.requests.length, 0);
});

test("Pi 0.87 finishTurn 阻止被拒绝工具继续运行，同时保留笔记边界", async (t) => {
  const host = await fixture(t, async (_requests, response) => tool(response));
  host.send(host.config);
  const call = await host.waitFor((event) => event.type === "tool_request");
  host.send({ type: "tool_result", request_id: call.request_id, decision: "blocked", is_error: true, content: [{ type: "text", text: "用户拒绝" }] });
  const result = await host.waitFor((event) => event.type === "result" || event.type === "error");
  assert.equal(result.type, "result", JSON.stringify(result));
  assert.equal(host.requests.length, 1);
  const jsonl = await readFile(result.session.session_file, "utf8");
  assert.match(jsonl, /runtime.md/);
});

test("Pi 0.87 保留 503 的可见重连和成功终态", async (t) => {
  const host = await fixture(t, async (requests, response) => {
    if (requests.length === 1) { response.writeHead(503, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { message: "503 Service unavailable" } })); return; }
    stream(response, { role: "assistant", content: "已恢复" }); stream(response, {}, "stop"); done(response);
  });
  host.send(host.config);
  const result = await host.waitFor((event) => event.type === "result" || event.type === "error");
  assert.equal(result.type, "result", JSON.stringify(result));
  assert.equal(host.requests.length, 2);
  assert.ok(host.events.some((event) => event.type === "event" && event.event.kind === "retry"));
  assert.equal(result.text, "已恢复");
});

test("上游 SSE 中途断开会重连，半截工具参数不会执行", async (t) => {
  const host = await fixture(t, async (requests, response) => {
    if (requests.length === 1) {
      stream(response, { role: "assistant", tool_calls: [{ index: 0, id: "call-partial", type: "function", function: { name: "test__inspect", arguments: '{"path":"' } }] });
      await delay(40);
      response.destroy();
      return;
    }
    if (requests.length === 2) { tool(response); return; }
    stream(response, { role: "assistant", content: "已恢复并完成读取" }); stream(response, {}, "stop"); done(response);
  });
  host.send({ ...host.config, retry: { max_retries: 2, base_delay_ms: 20, max_delay_ms: 50 } });
  const call = await host.waitFor((event) => event.type === "tool_request");
  assert.equal(host.requests.length, 2);
  assert.ok(host.events.some((event) => event.type === "event" && event.event.kind === "retry"));
  host.send({ type: "tool_result", request_id: call.request_id, decision: "executed", content: [{ type: "text", text: "读取完成" }], is_error: false });
  const result = await host.waitFor((event) => event.type === "result" || event.type === "error");
  assert.equal(result.type, "result", JSON.stringify(result));
  assert.equal(result.text, "已恢复并完成读取");
  assert.equal(host.events.filter((event) => event.type === "tool_request").length, 1);
});

for (const code of ["upstream_stream_read_error", "upstream_http2_stream_error", "stream_read_error"]) {
  test(`Responses ${code} 在工具参数输出中途重连，审批后继续且已执行工具不重放`, async (t) => {
    const host = await fixture(t, async (requests, response) => {
      if (requests.length === 1) {
        responseTool(response, "partial", false);
        responseEvent(response, "error", { code, message: "Upstream response stream was interrupted" });
        response.end(); return;
      }
      if (requests.length === 2) { responseTool(response, "complete", true); return; }
      if (requests.length === 3) {
        responseText(response, "未完成的回复片段", false);
        responseEvent(response, "error", { code, message: "Upstream response stream was interrupted" });
        response.end(); return;
      }
      responseText(response, "已恢复并完成本轮");
    });
    host.send({ ...host.config, model: { ...host.config.model, provider: "responses" } });
    const call = await host.waitFor(event => event.type === "tool_request");
    assert.equal(host.requests.length, 2);
    host.send({ type: "approval_wait", request_id: call.request_id });
    await delay(70);
    assert.equal(host.events.some(event => event.type === "result" || event.type === "error"), false);
    host.send({ type: "tool_result", request_id: call.request_id, decision: "executed", content: [{ type: "text", text: "工具已完成一次" }], is_error: false });
    const result = await host.waitFor(event => event.type === "result" || event.type === "error");
    assert.equal(result.type, "result", JSON.stringify(result));
    assert.equal(result.text, "已恢复并完成本轮");
    assert.equal(host.requests.length, 4);
    assert.equal(host.events.filter(event => event.type === "tool_request").length, 1);
    assert.ok(host.events.filter(event => event.type === "event" && event.event.kind === "retry" && event.event.status === "running").length >= 2);
    assert.doesNotMatch(JSON.stringify(host.requests[1]), /unfinished/);
    assert.doesNotMatch(JSON.stringify(host.requests[3]), /未完成的回复片段/);
    assert.match(JSON.stringify(host.requests[3]), /工具已完成一次/);
    const entries = (await readFile(result.session.session_file, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(entries.filter(entry => entry.type === "message" && entry.message.role === "user").length, 1);
    assert.ok(entries.filter(entry => entry.type === "context_edit").length >= 2);
  });
}

test("Responses 网关断流默认额外重试五次后结束，不会执行半截工具", async (t) => {
  const host = await fixture(t, async (_requests, response) => {
    responseTool(response, "partial", false);
    responseEvent(response, "error", { code: "upstream_http2_stream_error", message: "Upstream HTTP/2 stream failed" });
    response.end();
  });
  host.send({ ...host.config, model: { ...host.config.model, provider: "responses" }, retry: { max_retries: 5, base_delay_ms: 20, max_delay_ms: 30 } });
  const result = await host.waitFor(event => event.type === "result" || event.type === "error");
  assert.equal(result.type, "error");
  assert.match(result.message, /upstream_http2_stream_error/);
  assert.equal(host.requests.length, 6);
  assert.equal(host.events.filter(event => event.type === "tool_request").length, 0);
  const retries = host.events.filter(event => event.type === "event" && event.event.kind === "retry");
  assert.equal(retries.filter(event => event.event.status === "running").length, 5);
  assert.ok(retries.some(event => event.event.status === "error" && event.event.retry_attempt === 5));
});

test("Responses 额度耗尽不会被断流恢复规则重复提交", async (t) => {
  const host = await fixture(t, async (_requests, response) => {
    responseEvent(response, "response.failed", { response: { id: "resp-quota", status: "failed", output: [], error: { code: "insufficient_quota", message: "quota exceeded" } } });
    response.end();
  });
  host.send({ ...host.config, model: { ...host.config.model, provider: "responses" } });
  const result = await host.waitFor(event => event.type === "result" || event.type === "error");
  assert.equal(result.type, "error");
  assert.match(result.message, /insufficient_quota/);
  assert.equal(host.requests.length, 1);
});

test("Pi 0.87 Responses 适配器逐段输出且不重复正文", async (t) => {
  const host = await fixture(t, async (_requests, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (type, data) => response.write("event: " + type + "\ndata: " + JSON.stringify({ type, ...data }) + "\n\n");
    const item = { id: "msg-1", type: "message", role: "assistant", status: "in_progress", content: [] };
    emit("response.created", { response: { id: "resp-1", status: "in_progress", output: [] } });
    emit("response.output_item.added", { output_index: 0, item });
    emit("response.content_part.added", { item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
    emit("response.output_text.delta", { item_id: item.id, output_index: 0, content_index: 0, delta: "第一段" });
    await delay(200);
    emit("response.output_text.delta", { item_id: item.id, output_index: 0, content_index: 0, delta: "第二段" });
    item.status = "completed";
    item.content = [{ type: "output_text", text: "第一段第二段", annotations: [] }];
    emit("response.output_item.done", { output_index: 0, item });
    emit("response.completed", { response: { id: "resp-1", status: "completed", output: [item], usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } } });
    response.end();
  });
  host.send({ ...host.config, model: { ...host.config.model, provider: "responses" } });
  const result = await host.waitFor((event) => event.type === "result" || event.type === "error");
  assert.equal(result.type, "result", JSON.stringify(result));
  assert.equal(result.text, "第一段第二段");
  assert.equal(host.events.filter((event) => event.type === "delta").length, 2);
});

test("等待模型时中止会话会返回终态，不再发起后续请求", async (t) => {
  const host = await fixture(t, async (_requests, response) => {
    stream(response, { role: "assistant", content: "保留部分回复" });
  });
  host.send(host.config);
  await host.waitFor((event) => event.type === "delta");
  host.send({ type: "abort", request_id: "stop" });
  const stopped = await host.waitFor((event) => event.type === "result" && event.request_id === "stop");
  assert.match(stopped.text, /中止/);
  assert.equal(host.requests.length, 1);
});
