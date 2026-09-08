import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { hideProcessWindows, createApprovedTools, executeApprovedCommand, abortApprovedCommand, recordApproval } from "./builtin-tools.mjs";

import { InMemoryCredentialStore, Type } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const HOST_PROVIDER_ID = "plc-pilot";
hideProcessWindows();
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 4096;
const TOOL_TIMEOUT_MS = 120000;
const MAX_MODEL_RETRIES = 5;
const MODEL_RETRY_BASE_DELAY_MS = 1000;
const MAX_MODEL_RETRY_DELAY_MS = 60000;
let retryPreferences = { max_retries: MAX_MODEL_RETRIES, base_delay_ms: MODEL_RETRY_BASE_DELAY_MS, max_delay_ms: MAX_MODEL_RETRY_DELAY_MS };

let inputBuffer = "";
let activeSession = null;
let activeUnsubscribe = null;
let activeConfig = null;
const pendingToolRequests = new Map();
const pendingSteering = [];
const deliveredSteering = [];
let flushingSteering = false;
const activeToolArguments = new Map();
let compactionCount = 0;
let lastCompactedAt = null;
let retryAfterHintMs = null;
let retryStatusCode = null;
let lastThinkingSignalAt = 0;
let activeTurnIndex = 0;
const streamedToolSignals = new Map();
let previousGlobalFetch = null;
const nativeFetch = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendEvent(event) {
  writeMessage({ type: "event", event });
  if (activeSession && ["tool", "command", "approval", "safety", "progress", "compaction", "steering"].includes(event.kind) && event.status !== "running") {
    activeSession.sessionManager.appendCustomEntry("plc-pilot.activity", { turn_index: activeTurnIndex, event });
  }
}

function makeEvent(kind, title, detail = null, status = "done", tool = null, id = randomUUID()) {
  return {
    id,
    kind,
    title,
    detail: detail === undefined ? null : detail,
    status,
    tool,
  };
}

function truncateActivityText(value, maxLength = 140) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function stringifyToolDetail(value, maxLength = 2400) {
  if (value === undefined || value === null) return null;
  try {
    return truncateActivityText(JSON.stringify(value), maxLength);
  } catch {
    return truncateActivityText(value, maxLength);
  }
}

function toolArgument(args, names) {
  if (!args || typeof args !== "object") return "";
  for (const name of names) {
    const value = args[name];
    if (typeof value === "string" && value.trim()) return truncateActivityText(value);
  }
  return "";
}

/**
 * 将 Pi 的工具生命周期翻译成 Codex 风格的即时文案。
 *
 * 根本原因：只显示内部工具名会让用户无法判断 Agent 此刻到底在读什么、搜索什么，
 * 而 start/end 使用不同随机 ID 又会把同一次调用渲染成两条记录。这里始终沿用
 * toolCallId，并从只读参数里提取目标；前端因此能原位把“正在…”替换成“已…”。
 */
function toolActivityCopy(toolName, args, phase, isError = false) {
  const normalizedName = String(toolName ?? "tool").trim();
  const shortName = normalizedName.split(/__|[.:/\\]/).filter(Boolean).at(-1) || normalizedName;
  const lowerName = shortName.toLowerCase();
  const path = toolArgument(args, ["path", "file_path", "filePath", "directory", "cwd"]);
  const pattern = toolArgument(args, ["pattern", "query", "search", "glob"]);
  const command = toolArgument(args, ["command", "cmd", "script"]);
  const running = phase !== "done";
  const completedPrefix = isError ? "未能" : "已";

  if (/^(bash|shell|exec|execute|command|cmd|powershell|pwsh)$/i.test(lowerName)) {
    const target = command || shortName;
    return {
      kind: "command",
      title: running ? `正在运行 ${target}` : `${completedPrefix}运行 ${target}`,
    };
  }
  if (/^(read|read_file|readfile|get_content|getcontent)$/i.test(lowerName)) {
    const target = path || "文件";
    return { kind: "tool", title: running ? `正在读取 ${target}` : `${completedPrefix}读取 ${target}` };
  }
  if (/^(grep|search|rg)$/i.test(lowerName)) {
    const target = pattern || path || "内容";
    return { kind: "tool", title: running ? `正在搜索 ${target}` : `${completedPrefix}搜索 ${target}` };
  }
  if (/^(find|glob)$/i.test(lowerName)) {
    const target = pattern || path || "文件";
    return { kind: "tool", title: running ? `正在查找 ${target}` : `${completedPrefix}查找 ${target}` };
  }
  if (/^(ls|list|get-childitem|get_child_item|getchilditem)$/i.test(lowerName)) {
    const target = path || "目录";
    return { kind: "tool", title: running ? `正在读取目录 ${target}` : `${completedPrefix}读取目录 ${target}` };
  }
  if (/^(patch|apply_patch|edit|write|write_file)$/i.test(lowerName)) {
    const target = path || "文件";
    return { kind: "tool", title: running ? `正在更新 ${target}` : `${completedPrefix}更新 ${target}` };
  }
  return {
    kind: "tool",
    title: running ? `正在运行 ${shortName} 工具` : `${completedPrefix}使用 ${shortName} 工具`,
  };
}

function parseRetryAfterMs(headers) {
  const retryAfterMs = headers?.get?.("retry-after-ms");
  if (retryAfterMs) {
    const value = Number.parseFloat(retryAfterMs);
    if (Number.isFinite(value) && value >= 0) {
      return Math.min(retryPreferences.max_delay_ms, Math.round(value));
    }
  }
  const retryAfter = headers?.get?.("retry-after");
  if (!retryAfter) return null;
  const seconds = Number.parseFloat(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(retryPreferences.max_delay_ms, Math.round(seconds * 1000));
  }
  const timestamp = Date.parse(retryAfter);
  if (!Number.isNaN(timestamp)) {
    return Math.min(retryPreferences.max_delay_ms, Math.max(0, timestamp - Date.now()));
  }
  return null;
}

function retryAwareFetch(input, init) {
  if (!nativeFetch) throw new Error("当前 Node.js 没有可用的 fetch 实现");
  retryAfterHintMs = null;
  retryStatusCode = null;
  const result = nativeFetch(input, init);
  return Promise.resolve(result).then((response) => {
    if (!response.ok) {
      retryStatusCode = response.status;
      retryAfterHintMs = parseRetryAfterMs(response.headers);
    }
    return response;
  });
}

function extractHttpStatus(value) {
  const text = String(value ?? "");
  const matches = text.match(/\b[45]\d{2}\b/g) ?? [];
  const status = matches.map((item) => Number(item)).find((item) => item >= 400 && item <= 599);
  return Number.isFinite(status) ? status : null;
}

function formatRetryDelay(delayMs) {
  return delayMs >= 1000 ? `${(delayMs / 1000).toFixed(1)} 秒` : `${delayMs} 毫秒`;
}

function retryReason(errorMessage) {
  const status = extractHttpStatus(errorMessage) ?? retryStatusCode;
  return status ? `HTTP ${status}` : "连接或超时";
}

function emitRetryEvent({ attempt, delayMs = 0, statusCode = null, status = "running", title, detail }) {
  const event = makeEvent("retry", title, detail, status, null, `retry-${attempt}`);
  event.retry_attempt = attempt;
  event.retry_max_attempts = retryPreferences.max_retries;
  event.retry_delay_ms = delayMs;
  event.retry_status = statusCode;
  sendEvent(event);
}

function lastAssistantError(session) {
  const messages = session?.state?.messages;
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return message.stopReason === "error" ? message : null;
    }
  }
  return null;
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
  const reasoningLevels = Array.isArray(modelConfig?.reasoning_levels)
    ? modelConfig.reasoning_levels.map((level) => String(level).trim().toLowerCase()).filter(Boolean)
    : [];
  return {
    id: modelId,
    name: modelId,
    reasoning: reasoningLevels.some((level) => level !== "none"),
    // Pi 对 xhigh/max 要求显式能力映射，否则会把已选择的档位降为 high。
    // 使用用户的模型配置声明原值，不修改 SDK，也不把 max 假装成 xhigh。
    thinkingLevelMap: Object.fromEntries(["xhigh", "max"].map((level) => [
      level, reasoningLevels.includes(level) ? level : null,
    ])),
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

function persistSessionModelProfile(session, config) {
  const model = config.model ?? {};
  const profileId = String(model.id ?? "").trim();
  if (!profileId) return;
  const thinkingLevel = normalizeThinkingLevel(config.reasoning_effort, model);
  const context = session.sessionManager.buildSessionContext();
  if (context.model?.provider !== HOST_PROVIDER_ID || context.model?.modelId !== String(model.model)) {
    session.sessionManager.appendModelChange(HOST_PROVIDER_ID, String(model.model));
  }
  if (context.thinkingLevel !== thinkingLevel) {
    session.sessionManager.appendThinkingLevelChange(thinkingLevel);
  }
  const latestProfile = [...session.sessionManager.getEntries()]
    .reverse()
    .find((entry) => entry.type === "custom" && entry.customType === "plc-pilot.model-profile");
  if (latestProfile?.data?.profile_id === profileId
    && latestProfile?.data?.reasoning_effort === thinkingLevel
    && latestProfile?.data?.model_id === String(model.model ?? "")
    && latestProfile?.data?.context_window === (Number(model.context_window) || DEFAULT_CONTEXT_WINDOW)) {
    return;
  }
  session.sessionManager.appendCustomEntry("plc-pilot.model-profile", {
    profile_id: profileId,
    model_id: String(model.model ?? ""),
    reasoning_effort: thinkingLevel,
    context_window: Number(model.context_window) || DEFAULT_CONTEXT_WINDOW,
  });
}

function makeToolDefinition(tool, sendToolRequest) {
  const aliases = { apply_patch: "apply_patch", propose_write: "write", exec_command: "exec_command" };
  const name = tool.server_id === "builtin" && aliases[tool.name] ? aliases[tool.name] : String(tool.qualified_name ?? "").trim();
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
  if (event.type === "message_end") {
    if (event.message?.role === "user") {
      const text = typeof event.message.content === "string" ? event.message.content : (event.message.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
      const index = deliveredSteering.findIndex((input) => input.prompt === text);
      if (index >= 0) {
        const input = deliveredSteering.splice(index, 1)[0];
        activeTurnIndex = Math.max(0, activeSession.sessionManager.getEntries().filter((entry) => entry.type === "message" && entry.message?.role === "user").length - 1);
        const metadata = { turn_index: activeTurnIndex, text: input.message, attachments: input.attachments ?? [], references: input.references ?? [], response_annotations: input.response_annotations ?? [], skills: input.skills ?? [] };
        activeSession.sessionManager.appendCustomEntry("plc-pilot.ui-turn", metadata);
        sendEvent(makeEvent("steering", "已采用新的方向", JSON.stringify(metadata), "done", null, input.id));
      } else sendEvent(makeEvent("turn", "用户消息已记录", JSON.stringify({ turn_index: activeTurnIndex }), "done", null, "user-turn"));
    }
    if (event.message?.role === "assistant" && (event.message.stopReason === "toolUse" || deliveredSteering.length > 0)) {
      const progress = event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      if (progress.trim()) sendEvent(makeEvent("progress", "进度说明", progress, "done"));
    }
    writeMessage({ type: "session", session: sessionState() });
    void flushSteering();
  }
  if (event.type === "message_start" && event.message?.role === "assistant") {
    writeMessage({ type: "stream_start" });
    return;
  }
  if (event.type === "message_update") {
    const assistantEvent = event.assistantMessageEvent;
    if (assistantEvent?.type === "text_delta") {
      writeMessage({ type: "delta", delta: assistantEvent.delta });
    } else if (assistantEvent?.type?.startsWith("toolcall_")) {
      const call = assistantEvent.toolCall ?? assistantEvent.partial?.content?.[assistantEvent.contentIndex];
      if (call?.type === "toolCall" && call.id) {
        const previous = streamedToolSignals.get(call.id) ?? 0;
        if (!previous || Date.now() - previous >= 100 || assistantEvent.type === "toolcall_end") {
          streamedToolSignals.set(call.id, Date.now());
          sendEvent(makeEvent("tool", `正在准备 ${call.name || "工具调用"}`, stringifyToolDetail(call.arguments), "running", call.name || null, call.id));
        }
      }
    } else if (assistantEvent?.type === "thinking_start") {
      lastThinkingSignalAt = Date.now();
      writeMessage({ type: "thinking", phase: "start" });
    } else if (assistantEvent?.type === "thinking_delta") {
      // 原始思维内容不会跨进程发送；只用节流后的活动信号证明模型仍在持续工作。
      const now = Date.now();
      if (now - lastThinkingSignalAt >= 500) {
        lastThinkingSignalAt = now;
        writeMessage({ type: "thinking", phase: "activity" });
      }
    } else if (assistantEvent?.type === "thinking_end") {
      writeMessage({ type: "thinking", phase: "end" });
    }
    return;
  }
  if (event.type === "tool_execution_start") {
    const args = event.args ?? {};
    activeToolArguments.set(event.toolCallId, args);
    const copy = toolActivityCopy(event.toolName, args, "running");
    sendEvent(makeEvent(
      copy.kind,
      copy.title,
      stringifyToolDetail(args),
      "running",
      event.toolName,
      event.toolCallId,
    ));
    void flushSteering();
    return;
  }
  if (event.type === "tool_execution_update") {
    const args = event.args ?? activeToolArguments.get(event.toolCallId) ?? {};
    const copy = toolActivityCopy(event.toolName, args, "running");
    sendEvent(makeEvent(
      copy.kind,
      copy.title,
      JSON.stringify({ arguments: stringifyToolDetail(args, 8000), output: stringifyToolDetail(event.partialResult, 16000) }),
      "running",
      event.toolName,
      event.toolCallId,
    ));
    return;
  }
  if (event.type === "tool_execution_end") {
    const args = event.args ?? activeToolArguments.get(event.toolCallId) ?? {};
    activeToolArguments.delete(event.toolCallId);
    const copy = toolActivityCopy(event.toolName, args, "done", Boolean(event.isError));
    // 展示标题会截断长命令。把完整参数与输出分别保存，展开时才能还原 Shell
    // 命令行和原始换行，而不是把返回 JSON 和状态标题混成同一个段落。
    const detail = JSON.stringify({ arguments: stringifyToolDetail(args, 8000), output: stringifyToolDetail(event.result, 16000) });
    const decision = event.result?.details?.plcDecision;
    if (decision === "pending" || decision === "blocked") {
      sendEvent(makeEvent(decision === "pending" ? "approval" : "safety", decision === "pending" ? `等待审批 ${event.toolName}` : `已阻止 ${event.toolName}`, detail, decision === "pending" ? "waiting" : "blocked", event.toolName, event.toolCallId));
      return;
    }
    sendEvent(makeEvent(
      copy.kind,
      copy.title,
      detail,
      event.isError ? "warning" : "done",
      event.toolName,
      event.toolCallId,
    ));
    return;
  }
  if (event.type === "compaction_start") {
    sendEvent(makeEvent("compaction", "正在压缩会话上下文", `原因：${event.reason}`, "running", null, "compaction"));
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
      null,
      "compaction",
    ));
    return;
  }
  if (event.type === "auto_retry_start") {
    const statusCode = extractHttpStatus(event.errorMessage) ?? retryStatusCode;
    const title = `模型请求重试：第 ${event.attempt}/${event.maxAttempts} 次`;
    const detail = `${retryReason(event.errorMessage)}，等待 ${formatRetryDelay(event.delayMs)} 后再次请求。原因：${event.errorMessage}`;
    emitRetryEvent({
      attempt: event.attempt,
      delayMs: event.delayMs,
      statusCode,
      title,
      detail,
    });
    return;
  }
  if (event.type === "auto_retry_end") {
    const statusCode = extractHttpStatus(event.finalError) ?? retryStatusCode;
    const title = event.success
      ? `模型请求重试完成（第 ${event.attempt}/${retryPreferences.max_retries} 次）`
      : `模型请求重试已耗尽（第 ${event.attempt}/${retryPreferences.max_retries} 次）`;
    const detail = event.success
      ? "后续请求已恢复。"
      : `${retryReason(event.finalError)}仍未恢复。${event.finalError ?? "请检查模型接口配置。"}`;
    emitRetryEvent({
      attempt: event.attempt,
      delayMs: 0,
      statusCode,
      status: event.success ? "done" : "error",
      title,
      detail,
    });
    return;
  }
  if (event.type === "agent_start") {
    void flushSteering();
    sendEvent(makeEvent("model", "正在思考…", null, "running", null, "agent-run"));
    return;
  }
  if (event.type === "agent_settled") {
    sendEvent(makeEvent("model", "本轮处理已完成", null, "done", null, "agent-run"));
  }
}

/** 使用 Pi 原生 steer 队列，在当前工具完成后的模型调用前注入输入，不执行 abort。 */
async function flushSteering() {
  if (!activeSession || flushingSteering) return;
  flushingSteering = true;
  try {
    while (pendingSteering.length && activeSession.isStreaming) {
      const input = pendingSteering.shift();
      const references = (input.references ?? []).map((reference) => `${reference.label}: ${reference.path}`).join("\n");
      const skills = (input.skills ?? []).map((path) => `本次请使用 Skill：${path}`).join("\n");
      const prompt = [String(input.message ?? "").trim(), attachmentPromptText(input.attachments ?? []), responseAnnotationPromptText(input.response_annotations ?? []), references, skills].filter(Boolean).join("\n\n");
      deliveredSteering.push({ ...input, prompt });
      try { await activeSession.steer(prompt, codexImageInputs(input.attachments ?? [])); }
      catch (error) {
        deliveredSteering.splice(deliveredSteering.findIndex((item) => item.id === input.id), 1);
        sendEvent(makeEvent("steering_error", "方向调整尚未采用", String(error), "error", null, input.id));
      }
    }
  } finally { flushingSteering = false; }
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
  if (previousGlobalFetch) {
    globalThis.fetch = previousGlobalFetch;
    previousGlobalFetch = null;
  }
  activeConfig = null;
  compactionCount = 0;
  lastCompactedAt = null;
  retryAfterHintMs = null;
  retryStatusCode = null;
  activeToolArguments.clear();
}

function configSignature(config) {
  const model = config.model ?? {};
  return JSON.stringify({
    cwd: config.cwd,
    session_file: config.session_file,
    model_id: model.id,
    provider: model.provider,
    base_url: model.base_url,
    model: model.model,
    context_window: model.context_window,
    reasoning_levels: model.reasoning_levels,
    tool_names: (config.mcp_tools ?? []).map((tool) => tool.qualified_name),
    reasoning_effort: config.reasoning_effort ?? "medium",
    collaboration_mode: config.collaboration_mode ?? "default",
    skills: config.skills ?? [],
    references: config.references ?? [],
  });
}

function normalizeThinkingLevel(value, modelConfig = {}) {
  const normalized = String(value ?? "medium").trim().toLowerCase();
  const configured = Array.isArray(modelConfig.reasoning_levels)
    ? modelConfig.reasoning_levels.map((level) => String(level).trim().toLowerCase()).filter(Boolean)
    : [];
  const supported = configured.length > 0
    ? configured
    : ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  const requested = normalized === "off" ? "none" : normalized;
  if (supported.includes(requested)) return requested === "none" ? "off" : requested;
  if (supported.includes("medium")) return "medium";
  const fallback = supported.find((level) => level !== "none") ?? "none";
  return fallback === "none" ? "off" : fallback;
}

async function ensureSession(config) {
  const signature = configSignature(config);
  if (activeSession && activeConfig === signature) return activeSession;
  await disposeSession();

  retryPreferences = { ...retryPreferences, ...(config.retry ?? {}) };
  const cwd = config.cwd || resolveCwd(config.project);
  const sessionDir = sessionDirectory(config);
  const modelConfig = config.model ?? {};
  retryAfterHintMs = null;
  retryStatusCode = null;
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
  const customTools = [...(config.mcp_tools ?? []).map((tool) => makeToolDefinition(tool, sendRequest)), ...createApprovedTools(cwd, sendRequest)];
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
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: {
      enabled: retryPreferences.max_retries > 0,
      maxRetries: retryPreferences.max_retries,
      baseDelayMs: retryPreferences.base_delay_ms,
      // 消息级重试由 AgentSession 统一负责，避免供应商 SDK 的隐藏重试
      // 与界面上的次数不一致；Retry-After 仍由下方的会话适配层读取。
      provider: { maxRetries: 0, maxRetryDelayMs: retryPreferences.max_delay_ms },
    },
  });

  const created = await createAgentSession({
    cwd,
    agentDir: join(sessionDir, "agent"),
    modelRuntime: runtime,
    model,
    thinkingLevel: normalizeThinkingLevel(config.reasoning_effort, modelConfig),
    tools: toolNames,
    customTools,
    resourceLoader: loader,
    sessionManager,
    settingsManager,
  });
  activeSession = created.session;
  activeConfig = signature;

  // Pi SDK 的请求会沿用 Node 全局 fetch；在不复制供应商实现的前提下，
  // 通过这一层记录响应状态和 Retry-After，供 AgentSession 的重试事件
  // 使用真实服务端等待时间。宿主进程只服务当前会话，退出时恢复原 fetch。
  if (nativeFetch && !previousGlobalFetch) {
    previousGlobalFetch = globalThis.fetch;
    globalThis.fetch = retryAwareFetch;
  }

  // Pi 0.84 的通用分类覆盖 408/409/429/5xx 和连接错误，但网关暂时路由
  // 不到模型时常见的 404 没有进入同一条恢复链路。扩展实例方法只补这
  // 一个状态码，具体预算、退避、可中止等待和历史处理仍完全由 Pi 实现。
  const originalIsRetryableError = activeSession._isRetryableError?.bind(activeSession);
  if (originalIsRetryableError) {
    activeSession._isRetryableError = (message) => {
      if (originalIsRetryableError(message)) return true;
      return message?.stopReason === "error"
        && /\b404\b/.test(String(message.errorMessage ?? ""));
    };
  }

  // AgentSession 的原生退避默认使用固定 baseDelay；当服务端返回
  // Retry-After 时，仅临时替换本次调用读取到的设置，确保事件中的 delayMs
  // 与真实等待完全一致，调用结束后立即恢复设置方法。
  const originalPrepareRetry = activeSession._prepareRetry?.bind(activeSession);
  const originalGetRetrySettings = settingsManager.getRetrySettings.bind(settingsManager);
  if (originalPrepareRetry) {
    activeSession._prepareRetry = async (message) => {
      const previousGetter = settingsManager.getRetrySettings;
      settingsManager.getRetrySettings = () => {
        const settings = originalGetRetrySettings();
        const serverDelay = retryAfterHintMs;
        retryAfterHintMs = null;
        // Pi 会在此配置基础上再乘指数。把期望的实际等待换算回 base，避免
        // Retry-After 在第 2 次以后被重复放大；预算、等待、中止和历史处理仍归 Pi。
        const multiplier = 2 ** Number(activeSession._retryAttempt ?? 0);
        const delayMs = Math.min(retryPreferences.max_delay_ms, serverDelay ?? settings.baseDelayMs * multiplier * (0.85 + Math.random() * 0.3));
        return { ...settings, baseDelayMs: Math.round(delayMs) / multiplier };
      };
      try {
        return await originalPrepareRetry(message);
      } finally {
        settingsManager.getRetrySettings = previousGetter;
      }
    };
  }
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
  activeTurnIndex = session.sessionManager.getEntries().filter((entry) => entry.type === "message" && entry.message?.role === "user").length;
  session.sessionManager.appendCustomEntry("plc-pilot.ui-turn", {
    turn_index: activeTurnIndex, text: config.display_message ?? config.message,
    attachments: config.attachments ?? [], references: config.references ?? [],
    response_annotations: config.response_annotations ?? [], skills: config.skills ?? [],
    collaboration_mode: config.collaboration_mode,
  });
  if (!config.session_file && !config.session_name && config.message?.trim()) session.setSessionName(Array.from(config.message.trim().split("\n")[0]).slice(0, 40).join(""));
  // profile 元数据属于会话状态而非提示词；在用户消息前写入 JSONL，
  // 失败、中断或恢复会话时都能重新选择完全相同的 URL/Key/上下文配置。
  persistSessionModelProfile(session, config);
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
  const finalError = lastAssistantError(session);
  if (finalError) {
    throw new Error(finalError.errorMessage || "模型请求未完成");
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
  activeTurnIndex = Math.max(0, session.sessionManager.getEntries().filter((entry) => entry.type === "message" && entry.message?.role === "user").length - 1);
  const result = await session.compact(String(config.instructions ?? "").trim() || undefined);
  return {
    type: "result",
    request_id: config.request_id ?? null,
    text: result?.summary ? `上下文已压缩：${result.summary}` : "上下文已压缩。",
    session: sessionState(),
  };
}

async function handleCommand(command) {
  if (command.type === "steer") {
    pendingSteering.push(command);
    await flushSteering();
    return;
  }
  if (command.type === "execute_approved" || command.type === "record_approval") {
    try {
      if (command.type === "record_approval") {
        recordApproval(command.arguments, command.context);
        writeMessage({ type: "result", content: [], is_error: false });
      } else {
        const result = await executeApprovedCommand(command.arguments, (text) => writeMessage({ type: "tool_progress", text }));
        writeMessage({ type: "result", content: result.content, is_error: false });
      }
    } catch (error) { writeMessage({ type: "error", message: String(error) }); }
    return;
  }
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
    await abortApprovedCommand();
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
