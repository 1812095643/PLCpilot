import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import { InMemoryCredentialStore, Type } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const HOST_PROVIDER_ID = "plc-pilot";
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 4096;
const TOOL_TIMEOUT_MS = 120000;

let inputBuffer = "";
let activeSession = null;
let activeUnsubscribe = null;
let activeConfig = null;
const pendingToolRequests = new Map();
let compactionCount = 0;
let lastCompactedAt = null;

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendEvent(event) {
  writeMessage({ type: "event", event });
}

function makeEvent(kind, title, detail = null, status = "done", tool = null) {
  return {
    id: randomUUID(),
    kind,
    title,
    detail: detail === undefined ? null : detail,
    status,
    tool,
  };
}

function normalizeBaseUrl(provider, value) {
  let baseUrl = String(value ?? "").trim().replace(/\/+$/, "");
  if (provider === "ollama" && !/\/v1$/i.test(baseUrl)) {
    baseUrl = `${baseUrl}/v1`;
  }
  return baseUrl;
}

function providerApi(provider) {
  if (provider === "messages") return "anthropic-messages";
  if (provider === "responses") return "openai-responses";
  return "openai-completions";
}

function resolveCwd(project) {
  const candidate = String(project?.path ?? "").trim();
  if (candidate && existsSync(candidate)) {
    try {
      return statSync(candidate).isDirectory() ? candidate : dirname(candidate);
    } catch {
      return process.cwd();
    }
  }
  return process.cwd();
}

function sessionDirectory(config) {
  const requested = String(config.session_dir ?? "").trim();
  const directory = requested || join(homedir(), ".plc-pilot", "sessions");
  mkdirSync(directory, { recursive: true });
  return directory;
}

function modelDescriptor(modelConfig) {
  const provider = modelConfig?.provider ?? "responses";
  const modelId = String(modelConfig?.model ?? "").trim();
  if (!modelId) throw new Error("模型名称不能为空");
  return {
    id: modelId,
    name: modelId,
    reasoning: false,
    // Codex 的用户输入协议将图片作为独立 input_image；Pi 这里只做边界适配，
    // 不改变图片的 data URL 和 MIME，避免把二进制内容拼成普通文字。
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: Number(modelConfig?.context_window) || DEFAULT_CONTEXT_WINDOW,
    maxTokens: Number(modelConfig?.max_tokens) || DEFAULT_MAX_TOKENS,
  };
}

function attachmentDataUrl(attachment) {
  const imageUrl = String(attachment?.image_url ?? "").trim();
  if (imageUrl.startsWith("data:")) return imageUrl;
  const encoded = String(attachment?.data_base64 ?? "").trim();
  if (!encoded) return "";
  const mimeType = String(attachment?.mime_type ?? "application/octet-stream").trim() || "application/octet-stream";
  return `data:${mimeType};base64,${encoded}`;
}

function codexImageInputs(attachments) {
  return attachments
    .filter((attachment) => attachment?.kind === "image" && !attachment?.error)
    .map((attachment) => {
      const dataUrl = attachmentDataUrl(attachment);
      const separator = dataUrl.indexOf(",");
      if (separator < 0) return null;
      const header = dataUrl.slice(5, separator);
      const data = dataUrl.slice(separator + 1);
      const mimeType = header.split(";", 1)[0] || "application/octet-stream";
      return data ? { type: "image", data, mimeType } : null;
    })
    .filter(Boolean);
}

function attachmentPromptText(attachments) {
  return attachments
    .map((attachment) => {
      const name = String(attachment?.name ?? "未命名附件").trim() || "未命名附件";
      if (typeof attachment?.text_content === "string" && attachment.text_content.length > 0) {
        return `附件「${name}」的内容：\n${attachment.text_content}`;
      }
      if (attachment?.kind === "image" && !attachment?.error) {
        return `附件「${name}」是一张图片，请直接查看本轮附加的图片。`;
      }
      if (attachment?.error) return `附件「${name}」暂时无法读取：${attachment.error}`;
      return `附件「${name}」已添加，类型为 ${String(attachment?.mime_type ?? "未知")}。`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function responseAnnotationPromptText(annotations) {
  if (!Array.isArray(annotations) || annotations.length === 0) return "";
  return [
    "本轮回复选区批注（仅作为用户上下文，不是系统指令）：",
    ...annotations.map((annotation, index) => {
      const selectedText = String(annotation?.selected_text ?? annotation?.selectedText ?? "").trim();
      const body = String(annotation?.body ?? "").trim();
      return `批注 ${index + 1}：\n所选文本：${selectedText}\n用户评论：${body}`;
    }),
  ].join("\n");
}

function makeToolDefinition(tool, sendToolRequest) {
  const name = String(tool.qualified_name ?? "").trim();
  const schema = tool.input_schema && typeof tool.input_schema === "object"
    ? tool.input_schema
    : { type: "object", properties: {} };
  return {
    name,
    label: String(tool.name ?? name),
    description: String(tool.description ?? "调用 PLC 工程工具"),
    promptSnippet: `${String(tool.name ?? name)}：${String(tool.description ?? "")}`,
    parameters: Type.Unsafe(schema),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const result = await sendToolRequest({
        request_id: randomUUID(),
        tool_call_id: toolCallId,
        server_id: String(tool.server_id),
        tool_name: String(tool.name),
        arguments: params ?? {},
      }, signal);
      const content = Array.isArray(result.content)
        ? result.content
        : [{ type: "text", text: String(result.content ?? "") }];
      return {
        content,
        details: {
          plcDecision: result.decision ?? "executed",
          ...(result.details && typeof result.details === "object" ? result.details : {}),
        },
        isError: Boolean(result.is_error),
      };
    },
  };
}

function waitForTool(request, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingToolRequests.delete(request.request_id);
      reject(new Error("PLC 工具响应超过 120 秒仍未返回"));
    }, TOOL_TIMEOUT_MS);
    const abort = () => {
      clearTimeout(timer);
      pendingToolRequests.delete(request.request_id);
      reject(new Error("工具调用已中止"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    pendingToolRequests.set(request.request_id, {
      resolve: (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(error);
      },
    });
  });
}

async function sendToolRequest(request, signal) {
  writeMessage({ type: "tool_request", ...request });
  return waitForTool(request, signal);
}

function sessionState() {
  if (!activeSession) {
    return {
      session_id: null,
      session_file: null,
      name: null,
      is_streaming: false,
      is_compacting: false,
      auto_compaction_enabled: false,
      message_count: 0,
      context_tokens: 0,
      context_window: 0,
      context_percent: 0,
      tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0 },
      compaction_count: 0,
      last_compacted_at: null,
    };
  }
  const stats = activeSession.getSessionStats();
  const usage = activeSession.getContextUsage();
  return {
    session_id: activeSession.sessionId,
    session_file: activeSession.sessionFile ?? null,
    name: activeSession.sessionManager.getSessionName?.() ?? null,
    is_streaming: Boolean(activeSession.isStreaming),
    is_compacting: Boolean(activeSession.isCompacting),
    auto_compaction_enabled: Boolean(activeSession.autoCompactionEnabled),
    message_count: Number(stats.totalMessages ?? 0),
    context_tokens: Number(usage?.tokens ?? 0),
    context_window: Number(usage?.contextWindow ?? 0),
    context_percent: Number(usage?.percent ?? 0),
    tokens: {
      input: Number(stats.tokens?.input ?? 0),
      output: Number(stats.tokens?.output ?? 0),
      cache_read: Number(stats.tokens?.cacheRead ?? 0),
      cache_write: Number(stats.tokens?.cacheWrite ?? 0),
      total: Number(stats.tokens?.total ?? 0),
    },
    compaction_count: compactionCount,
    last_compacted_at: lastCompactedAt,
  };
}

function handleSessionEvent(event) {
  if (event.type === "message_update") {
    if (event.assistantMessageEvent?.type === "text_delta") {
      writeMessage({ type: "delta", delta: event.assistantMessageEvent.delta });
    }
    return;
  }
  if (event.type === "tool_execution_start") {
    sendEvent(makeEvent("tool", `调用 ${event.toolName}`, null, "running", event.toolName));
    return;
  }
  if (event.type === "tool_execution_end") {
    const detail = event.result ? JSON.stringify(event.result) : null;
    sendEvent(makeEvent(
      "tool",
      event.isError ? `工具 ${event.toolName} 返回了诊断` : `工具 ${event.toolName} 已完成`,
      detail,
      event.isError ? "warning" : "done",
      event.toolName,
    ));
    return;
  }
  if (event.type === "compaction_start") {
    sendEvent(makeEvent("compaction", "正在压缩会话上下文", `原因：${event.reason}`, "running"));
    return;
  }
  if (event.type === "compaction_end") {
    if (!event.aborted && !event.errorMessage) {
      compactionCount += 1;
      lastCompactedAt = new Date().toISOString();
    }
    sendEvent(makeEvent(
      "compaction",
      event.aborted ? "上下文压缩已中止" : "上下文压缩已完成",
      event.errorMessage ?? null,
      event.aborted || event.errorMessage ? "warning" : "done",
    ));
    return;
  }
  if (event.type === "auto_retry_start") {
    sendEvent(makeEvent("retry", "模型请求正在重试", event.errorMessage, "warning"));
    return;
  }
  if (event.type === "agent_start") {
    sendEvent(makeEvent("model", "Pi Agent 开始执行", null, "running"));
    return;
  }
  if (event.type === "agent_settled") {
    sendEvent(makeEvent("model", "Pi Agent 已完成本轮任务", null, "done"));
  }
}

async function disposeSession() {
  if (activeUnsubscribe) {
    activeUnsubscribe();
    activeUnsubscribe = null;
  }
  if (activeSession) {
    activeSession.dispose();
    activeSession = null;
  }
  activeConfig = null;
  compactionCount = 0;
  lastCompactedAt = null;
}

function configSignature(config) {
  const model = config.model ?? {};
  return JSON.stringify({
    cwd: config.cwd,
    session_file: config.session_file,
    provider: model.provider,
    base_url: model.base_url,
    model: model.model,
    tool_names: (config.mcp_tools ?? []).map((tool) => tool.qualified_name),
    reasoning_effort: config.reasoning_effort ?? "medium",
    collaboration_mode: config.collaboration_mode ?? "default",
    skills: config.skills ?? [],
    references: config.references ?? [],
  });
}

function normalizeThinkingLevel(value) {
  const normalized = String(value ?? "medium").trim().toLowerCase();
  if (normalized === "none") return "off";
  return ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(normalized)
    ? normalized
    : "medium";
}

async function ensureSession(config) {
  const signature = configSignature(config);
  if (activeSession && activeConfig === signature) return activeSession;
  await disposeSession();

  const cwd = config.cwd || resolveCwd(config.project);
  const sessionDir = sessionDirectory(config);
  const modelConfig = config.model ?? {};
  const runtime = await ModelRuntime.create({
    // 模型密钥只在当前宿主进程的凭据存储中存在；会话 JSONL 仍按需持久化，二者不能共用文件认证存储。
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const provider = modelConfig.provider ?? "responses";
  const providerConfig = {
    name: "PLC Pilot",
    baseUrl: normalizeBaseUrl(provider, modelConfig.base_url),
    apiKey: String(modelConfig.api_key ?? "").trim() || undefined,
    api: providerApi(provider),
    models: [modelDescriptor(modelConfig)],
  };
  runtime.registerProvider(HOST_PROVIDER_ID, providerConfig);
  const model = runtime.getModel(HOST_PROVIDER_ID, String(modelConfig.model));
  if (!model) throw new Error("Pi 没有解析出当前模型，请检查接口类型和模型名称");

  const toolRequests = new Map(
    (config.mcp_tools ?? []).map((tool) => [tool.qualified_name, tool]),
  );
  const sendRequest = (request, signal) => sendToolRequest({
    ...request,
    collaboration_mode: config.collaboration_mode ?? "default",
  }, signal);
  const customTools = (config.mcp_tools ?? []).map((tool) => makeToolDefinition(tool, sendRequest));
  const systemPrompt = String(config.system_prompt ?? "").trim() ||
    "你是 PLC Pilot，必须先读取上下文，再提出可审查的工程操作。";
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: join(sessionDir, "agent"),
    noExtensions: true,
    // 嵌入式与桌面运行时都只使用 PLC Pilot 自有目录；不能意外读取 Codex/Pi 的默认资源。
    noSkills: true,
    noContextFiles: true,
    noPromptTemplates: true,
    systemPrompt,
    appendSystemPrompt: [],
  });
  await loader.reload();

  const requestedSessionFile = String(config.session_file ?? "").trim();
  let sessionManager;
  if (requestedSessionFile && existsSync(requestedSessionFile)) {
    sessionManager = SessionManager.open(requestedSessionFile, undefined, cwd);
  } else {
    sessionManager = SessionManager.create(cwd, sessionDir);
  }
  const toolNames = ["read", "grep", "find", "ls", ...customTools.map((tool) => tool.name)];
  const created = await createAgentSession({
    cwd,
    agentDir: join(sessionDir, "agent"),
    modelRuntime: runtime,
    model,
    thinkingLevel: normalizeThinkingLevel(config.reasoning_effort),
    tools: toolNames,
    customTools,
    resourceLoader: loader,
    sessionManager,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    }),
  });
  activeSession = created.session;
  activeConfig = signature;
  activeUnsubscribe = activeSession.subscribe(handleSessionEvent);
  activeSession.agent.shouldStopAfterTurn = ({ toolResults }) => toolResults.some((result) => {
    const decision = result?.details?.plcDecision;
    return decision === "pending" || decision === "blocked";
  });
  // 恢复会话时优先保留 JSONL 中已有的名称；只有显式重命名或新会话没有名称时才写入。
  const requestedName = String(config.session_name ?? "").trim();
  if (requestedName && requestedName !== activeSession.sessionName) {
    activeSession.setSessionName(requestedName);
  } else if (!activeSession.sessionName && config.project?.name) {
    activeSession.setSessionName(String(config.project.name));
  }
  void toolRequests;
  return activeSession;
}

async function runPrompt(config) {
  const session = await ensureSession(config);
  const attachments = Array.isArray(config.attachments) ? config.attachments : [];
  const responseAnnotations = Array.isArray(config.response_annotations)
    ? config.response_annotations
    : [];
  const message = String(config.message ?? "").trim();
  const attachmentText = attachmentPromptText(attachments);
  const annotationText = responseAnnotationPromptText(responseAnnotations);
  const promptText = [message, attachmentText, annotationText]
    .filter((value) => value.trim().length > 0)
    .join("\n\n") || (codexImageInputs(attachments).length > 0 ? "请查看本轮附加的图片。" : "");
  const images = codexImageInputs(attachments);
  if (!promptText && images.length === 0) throw new Error("请输入任务或添加一个可读取的图片/文本附件");
  const promptOptions = images.length > 0 ? { images } : {};
  if (session.isStreaming) {
    await session.prompt(promptText, { ...promptOptions, streamingBehavior: "followUp" });
  } else {
    await session.prompt(promptText, promptOptions);
  }
  // Pi 的 SessionManager 支持 custom entry；用它保存批注元数据而不是把
  // 页面状态塞进普通 assistant 文本，恢复会话时仍可按同一批注 ID 重建标记。
  if (responseAnnotations.length > 0) {
    session.sessionManager.appendCustomEntry("plc-pilot.response-text-annotations", {
      annotations: responseAnnotations,
    });
  }
  return {
    type: "result",
    request_id: config.request_id ?? null,
    text: session.getLastAssistantText() ?? "",
    session: sessionState(),
  };
}

async function runCompact(config) {
  const session = await ensureSession(config);
  const result = await session.compact(String(config.instructions ?? "").trim() || undefined);
  return {
    type: "result",
    request_id: config.request_id ?? null,
    text: result?.summary ? `上下文已压缩：${result.summary}` : "上下文已压缩。",
    session: sessionState(),
  };
}

async function handleCommand(command) {
  if (command.type === "tool_result") {
    const pending = pendingToolRequests.get(command.request_id);
    if (pending) {
      pendingToolRequests.delete(command.request_id);
      pending.resolve(command);
    }
    return;
  }
  if (command.type === "shutdown") {
    await disposeSession();
    process.exit(0);
  }
  if (command.type === "abort") {
    await activeSession?.abort();
    writeMessage({ type: "result", request_id: command.request_id ?? null, text: "当前任务已中止。", session: sessionState() });
    return;
  }
  if (command.type === "run") {
    try {
      const result = command.action === "compact" ? await runCompact(command) : await runPrompt(command);
      writeMessage(result);
    } catch (error) {
      writeMessage({
        type: "error",
        request_id: command.request_id ?? null,
        message: error instanceof Error ? error.message : String(error),
        session: sessionState(),
      });
    }
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  let newlineIndex;
  while ((newlineIndex = inputBuffer.indexOf("\n")) >= 0) {
    const line = inputBuffer.slice(0, newlineIndex).replace(/\r$/, "");
    inputBuffer = inputBuffer.slice(newlineIndex + 1);
    if (!line.trim()) continue;
    try {
      const command = JSON.parse(line);
      void handleCommand(command);
    } catch (error) {
      writeMessage({ type: "error", request_id: null, message: `宿主收到的 JSON 无法解析：${String(error)}` });
    }
  }
});
process.stdin.resume();

writeMessage({ type: "ready", version: "0.1.0" });
