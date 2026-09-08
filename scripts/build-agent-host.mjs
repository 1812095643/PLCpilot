import { build } from "esbuild";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadTool, createGrepTool, createFindTool, createLsTool, createEditTool, createPowerShellTool } from "@earendil-works/pi-coding-agent";

// Pi 注册模型提供方时会静态导入部分云 SDK；把它们标记为 external 后，
// 开发目录可借用上级 node_modules 启动，换到空电脑却会在 ready 前退出。
// 让 esbuild 正常合并和 tree-shaking，不复制开发依赖树，也不裁剪上游实现。
await build({
  entryPoints: ["agent-host/pi-agent-host.mjs"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  banner: {
    js: "import { createRequire as createPlcRequire } from 'node:module'; const require = createPlcRequire(import.meta.url);",
  },
  outfile: "agent-host/pi-agent-host.bundle.mjs",
});

// 发布前在仓库外启动真实 bundle，防止上级 node_modules 掩盖遗漏的运行依赖。
const checkRoot = await mkdtemp(join(tmpdir(), "plc-pilot-host-"));
try {
  const script = join(checkRoot, "pi-agent-host.bundle.mjs");
  await copyFile("agent-host/pi-agent-host.bundle.mjs", script);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: checkRoot, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let error = "";
    let ready = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error("发布宿主 15 秒内未就绪")); }, 15000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (!ready && output.split(/\r?\n/).some((line) => line.startsWith('{"type":"ready"'))) {
        ready = true;
        child.stdin.end(`${JSON.stringify({ type: "shutdown" })}\n`);
      }
    });
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", (cause) => { clearTimeout(timer); reject(cause); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (ready && code === 0) resolve();
      else reject(new Error(`发布宿主无法独立运行（退出码 ${code}）：${error.slice(-3000)}`));
    });
  });
} finally {
  await rm(checkRoot, { recursive: true, force: true });
}

// 工具目录直接取 Pi 工厂返回的真实 schema，避免 UI 目录与实际工具参数漂移。
const catalog = [createReadTool("."), createGrepTool("."), createFindTool("."), createLsTool("."), createEditTool("."), createPowerShellTool(".")];
catalog.push({ ...createFindTool("."), name: "glob" }, { ...createLsTool("."), name: "Get-ChildItem" });
await writeFile("agent-host/tool-catalog.json", `${JSON.stringify(catalog.map((tool) => ({ qualified_name: tool.name, server_id: "pi", name: tool.name, description: tool.description, input_schema: tool.parameters, mutating: ["edit", "powershell"].includes(tool.name) })), null, 2)}\n`);
