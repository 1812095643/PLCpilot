import { build } from 'esbuild'
import { copyFile, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publicTools } from '../stone-mcp/server.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'stone-mcp', 'dist')
await rm(output, { recursive: true, force: true })
await mkdir(join(output, 'data'), { recursive: true })
await build({
  entryPoints: [join(root, 'stone-mcp', 'entry.mjs')], bundle: true, platform: 'node', format: 'esm',
  target: 'node22', minify: true, outfile: join(output, 'stone-mcp-server.mjs'),
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
})
await copyFile(join(root, 'stone-mcp', 'bridge.py'), join(output, 'bridge.py'))
await writeFile(join(output, 'data', 'official-api.json.gz'), gzipSync(await readFile(join(root, 'stone-mcp', 'data', 'official-api.json')), { level: 9 }))
await copyFile(join(root, 'stone-mcp', 'README.md'), join(output, 'README.md'))
await copyFile(join(root, 'node_modules', '@modelcontextprotocol', 'sdk', 'LICENSE'), join(output, 'MCP-SDK-LICENSE'))
// Rust 审批和 MCP 注解来自同一目录，避免 AddFile/Build 等绕过原有关键词判断。
await writeFile(join(root, 'stone-mcp', 'tool-policy.json'), `${JSON.stringify(Object.fromEntries(publicTools.map(tool => [tool.name, !tool.annotations.readOnlyHint])), null, 2)}\n`)
console.log('已构建 STone MCP 独立包：stone-mcp/dist（复用 PLC Pilot 内置 Node）')
