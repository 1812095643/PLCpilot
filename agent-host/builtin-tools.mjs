import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { access, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { createEditTool, createFindTool, createLsTool, createPowerShellTool, SessionManager } from "@earendil-works/pi-coding-agent";

/** Pi 的检索工具会启动 rg/fd；统一补 Windows 创建参数，不更改工具或进程算法。 */
export function hideProcessWindows() {
  if (process.platform !== "win32") return;
  for (const name of ["spawn", "spawnSync"]) {
    const original = childProcess[name];
    childProcess[name] = (command, args, options) => Array.isArray(args)
      ? original(command, args, { ...options, windowsHide: true })
      : original(command, { ...args, windowsHide: true });
  }
  syncBuiltinESMExports();
}

function toolResult(result) {
  return { content: result.content, details: { plcDecision: result.decision, ...result.details }, isError: Boolean(result.is_error) };
}

export function createApprovedTools(cwd, sendRequest) {
  const request = async (name, args, callId, signal) => toolResult(await sendRequest({ request_id: randomUUID(), tool_call_id: callId, server_id: "builtin", tool_name: name, arguments: args }, signal));
  const originalFind = createFindTool(cwd);
  const originalLs = createLsTool(cwd);
  const powershell = createPowerShellTool(cwd, { exposeSessionEnvironment: false });
  const originalEdit = createEditTool(cwd);
  return [
    { ...originalFind, name: "glob", label: "查找文件" },
    { ...originalLs, name: "Get-ChildItem", label: "列出目录" },
    { ...powershell, name: "powershell", execute: (id, params, signal) => request("exec_command", params, id, signal) },
    {
      ...originalEdit,
      description: `${originalEdit.description} 修改先提交用户审批，审批前不会写盘。`,
      execute: async (id, params, signal) => {
        let before; let approval;
        const validate = async (path) => {
          const root = await realpath(cwd); const target = await realpath(path); const child = relative(root, target);
          if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error("文件必须位于当前工作目录内。");
          return target;
        };
        // 使用 Pi 官方的可插拔 EditOperations 计算修改；写入操作交给审批层。
        const editor = createEditTool(cwd, { operations: {
          readFile: async (path) => { const data = await readFile(await validate(path)); before = data.toString("utf8"); return data; },
          access: async (path) => access(await validate(path)),
          writeFile: async (path, content) => { approval = await request("propose_write", { path: await validate(path), content, expected: before }, id, signal); },
        } });
        await editor.execute(id, params, signal);
        if (!approval) throw new Error("没有生成可审批的文件修改。");
        return approval;
      },
    },
  ];
}

let commandController;
let commandPromise;

export async function abortApprovedCommand() {
  commandController?.abort();
  await commandPromise?.catch(() => undefined);
}

export function recordApproval(argumentsValue, content) {
  if (!argumentsValue.session_file) return;
  const session = SessionManager.open(argumentsValue.session_file, undefined, argumentsValue.cwd);
  session.appendCustomMessageEntry("plc-pilot.approval-result", `用户已批准的工具执行结果：\n${JSON.stringify(content)}`, false);
}

export async function executeApprovedCommand(argumentsValue, onUpdate) {
  const tool = createPowerShellTool(argumentsValue.cwd, { exposeSessionEnvironment: false });
  commandController = new AbortController();
  commandPromise = tool.execute(randomUUID(), { command: argumentsValue.command, timeout: Math.min(120, argumentsValue.timeout ?? 120) }, commandController.signal, (result) => {
    onUpdate(result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"));
  });
  try {
    const result = await commandPromise;
    recordApproval(argumentsValue, result.content);
    return result;
  } finally { commandController = null; commandPromise = null; }
}
