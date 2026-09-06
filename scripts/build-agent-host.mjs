import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { createReadTool, createGrepTool, createFindTool, createLsTool, createEditTool, createPowerShellTool } from "@earendil-works/pi-coding-agent";

// Pi 的完整依赖树包含可选的云厂商 SDK。PLC Pilot 初版只需要
// Responses、Messages、Chat Completions 和 Ollama；这些可选模块不在
// 启动路径上，因此保留为外部动态模块，避免把它们的长路径 node_modules
// 逐个交给 Windows 安装器处理。
await build({
  entryPoints: ["agent-host/pi-agent-host.mjs"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  external: ["@aws-sdk/*", "@google/*", "@google-cloud/*", "@smithy/*"],
  banner: {
    js: "import { createRequire as createPlcRequire } from 'node:module'; const require = createPlcRequire(import.meta.url);",
  },
  outfile: "agent-host/pi-agent-host.bundle.mjs",
});

// 工具目录直接取 Pi 工厂返回的真实 schema，避免 UI 目录与实际工具参数漂移。
const catalog = [createReadTool("."), createGrepTool("."), createFindTool("."), createLsTool("."), createEditTool("."), createPowerShellTool(".")];
catalog.push({ ...createFindTool("."), name: "glob" }, { ...createLsTool("."), name: "Get-ChildItem" });
await writeFile("agent-host/tool-catalog.json", `${JSON.stringify(catalog.map((tool) => ({ qualified_name: tool.name, server_id: "pi", name: tool.name, description: tool.description, input_schema: tool.parameters, mutating: ["edit", "powershell"].includes(tool.name) })), null, 2)}\n`);
