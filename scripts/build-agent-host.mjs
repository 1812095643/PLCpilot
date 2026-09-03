import { build } from "esbuild";

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
