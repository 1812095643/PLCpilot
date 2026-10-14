import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(join(tmpdir(), 'plc-packaged-check-'))
async function findResourceRoot(directory, depth = 0) {
  if (existsSync(join(directory, 'runtime/runtime-manifest.json'))) return directory
  if (depth >= 5) return null
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const found = await findResourceRoot(join(directory, entry.name), depth + 1)
      if (found) return found
    }
  }
  return null
}

try {
  let resources
  const bundle = join(root, 'src-tauri/target/release/bundle')
  if (process.platform === 'win32') resources = join(root, 'output/PLC-Pilot-Portable')
  else if (process.platform === 'darwin') {
    const apps = (await readdir(join(bundle, 'macos'))).filter(name => name.endsWith('.app'))
    assert.equal(apps.length, 1)
    const app = join(bundle, 'macos', apps[0])
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
    resources = join(app, 'Contents/Resources')
  } else {
    const images = (await readdir(join(bundle, 'appimage'))).filter(name => name.endsWith('.AppImage'))
    assert.equal(images.length, 1)
    execFileSync(join(bundle, 'appimage', images[0]), ['--appimage-extract'], { cwd: temporary, stdio: 'pipe', maxBuffer: 100 * 1024 * 1024 })
    resources = await findResourceRoot(join(temporary, 'squashfs-root'))
  }
  assert.ok(resources, 'Cannot locate packaged resources')
  const runtime = join(resources, 'runtime')
  const manifest = JSON.parse(await readFile(join(runtime, 'runtime-manifest.json'), 'utf8'))
  assert.equal(manifest.platform, process.platform)
  assert.equal(manifest.arch, process.arch)
  const node = join(runtime, manifest.node.executable)
  const python = join(runtime, manifest.python.executable)
  assert.equal(execFileSync(node, ['--version'], { encoding: 'utf8' }).trim(), manifest.node.version)
  const environment = { ...process.env, PYTHONHOME: '', PYTHONPATH: '', PYTHONNOUSERSITE: '1', PYTHONUSERBASE: join(temporary, 'python-user'), PLC_PILOT_LOG_DIR: join(temporary, 'logs') }
  execFileSync(python, ['-B', '-s', '-c', 'import sys, pathlib, ctypes, docx, yaml, latex2mathml, playwright, mammoth, pptx, PIL, xlsxwriter; root=pathlib.Path(sys.executable).resolve().parent; assert all(pathlib.Path(m.__file__).resolve().is_relative_to(root.parent if root.name == "bin" else root) for m in [docx,yaml,latex2mathml,mammoth,pptx,PIL,xlsxwriter]); ctypes.CDLL(sys.argv[1]); print("Packaged Python, Office libraries and PDFium passed")', join(runtime, manifest.pdf.executable)], { env: environment, cwd: temporary, stdio: 'inherit' })
  assert.ok(existsSync(join(resources, 'skills/patent-disclosure-skill/SKILL.md')))
  const host = spawn(node, [join(resources, 'pi-agent-host.bundle.mjs')], { cwd: temporary, env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  await new Promise((resolveReady, reject) => {
    let ready = false
    let errors = ''
    const timer = setTimeout(() => { host.kill(); reject(new Error('Packaged agent host did not become ready')) }, 20000)
    const lines = createInterface({ input: host.stdout })
    host.stderr.on('data', chunk => { errors += chunk })
    host.on('error', error => { clearTimeout(timer); reject(error) })
    lines.on('line', line => {
      try { if (JSON.parse(line).type === 'ready') { ready = true; host.stdin.end(`${JSON.stringify({ type: 'shutdown' })}\n`) } } catch {}
    })
    host.on('close', code => { clearTimeout(timer); lines.close(); if (ready && code === 0) resolveReady(); else reject(new Error(`Packaged host exited ${code}: ${errors.slice(-2000)}`)) })
  })
  const transport = new StdioClientTransport({ command: node, args: [join(resources, 'stone-mcp/stone-mcp-server.mjs')], cwd: temporary, env: { ...environment, STONE_CLI_PATH: join(temporary, 'not-installed/SToneCLI.exe') }, stderr: 'pipe' })
  const client = new Client({ name: 'plc-pilot-release-check', version: '1.0.0' }, { capabilities: {} })
  try {
    await client.connect(transport)
    const result = await client.listTools()
    assert.ok(result.tools.length > 5, 'Packaged STone catalog is incomplete')
  } finally { await client.close() }
  console.log(`Packaged runtime passed: ${process.platform}-${process.arch}`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
