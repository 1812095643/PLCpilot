import { build } from "esbuild";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createReadTool, createGrepTool, createFindTool, createLsTool, createEditTool, createPowerShellTool, createBashTool } from "@earendil-works/pi-coding-agent";

await build({
  entryPoints: ["agent-host/pi-agent-host.mjs"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  alias: {
    "#pi-http-dispatcher": join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "core/http-dispatcher.js"),
  },
  minify: true,
  banner: {
    js: "import { createRequire as createPlcRequire } from 'node:module'; const require = createPlcRequire(import.meta.url);",
  },
  outfile: "agent-host/pi-agent-host.bundle.mjs",
});

const checkRoot = await mkdtemp(join(tmpdir(), "plc-pilot-host-"));
try {
  const script = join(checkRoot, "pi-agent-host.bundle.mjs");
  await copyFile("agent-host/pi-agent-host.bundle.mjs", script);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: checkRoot, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let error = "";
    let ready = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error("Agent host did not become ready within 15 seconds")); }, 15000);
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
      else reject(new Error(`Agent bundle cannot run independently (exit ${code}): ${error.slice(-3000)}`));
    });
  });
} finally {
  await rm(checkRoot, { recursive: true, force: true });
}

const catalog = [createReadTool("."), createGrepTool("."), createFindTool("."), createLsTool("."), createEditTool("."), process.platform === "win32" ? createPowerShellTool(".") : createBashTool(".")];
catalog.push({ ...createFindTool("."), name: "glob" }, { ...createLsTool("."), name: "Get-ChildItem" });
await writeFile("agent-host/tool-catalog.json", `${JSON.stringify(catalog.map((tool) => ({ qualified_name: tool.name, server_id: "pi", name: tool.name, description: tool.description, input_schema: tool.parameters, mutating: ["edit", "powershell", "bash"].includes(tool.name) })), null, 2)}\n`);
