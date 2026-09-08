import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = join(projectRoot, 'runtime-stage')
const nodeSource = process.env.PLC_PILOT_NODE_SOURCE || process.execPath
const nodeSourceRoot = dirname(nodeSource)
const pythonEmbedUrl = process.env.PLC_PILOT_PYTHON_EMBED_URL || 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip'
const archiveRoot = join(projectRoot, 'tmp', 'plc-pilot-runtime-cache')
const pythonArchive = join(archiveRoot, 'python-3.12.10-embed-amd64.zip')
const pythonExtractRoot = join(archiveRoot, 'python-3.12.10-embed-amd64')
const pipWheel = join(archiveRoot, 'pip-26.0.1-py3-none-any.whl')
const pipWheelUrl = 'https://files.pythonhosted.org/packages/de/f0/c81e05b613866b76d2d1066490adf1a3dbc4ee9d9c839961c3fc8a6997af/pip-26.0.1-py3-none-any.whl'
const pipSha256 = 'bdb1b08f4274833d62c1aa29e20907365a2ceb950410df15fc9521bad440122b'

async function copyRequired(source, target) {
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { recursive: true, force: true })
}

/** 下载官方发布文件至构建缓存；已存在时复用，不复制开发机的已安装依赖。 */
async function downloadFile(url, target) {
  await mkdir(archiveRoot, { recursive: true })
  if (existsSync(target)) return
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`下载运行时文件未完成：HTTP ${response.status}（${url}）`)
  await writeFile(target, Buffer.from(await response.arrayBuffer()))
}

async function extractPythonArchive() {
  await downloadFile(pythonEmbedUrl, pythonArchive)
  await rm(pythonExtractRoot, { recursive: true, force: true })
  await mkdir(pythonExtractRoot, { recursive: true })
  execFileSync('tar.exe', ['-xf', pythonArchive, '-C', pythonExtractRoot], { stdio: 'inherit' })
  return pythonExtractRoot
}

async function prepareNode() {
  const targetRoot = join(runtimeRoot, 'node')
  await copyRequired(nodeSource, join(targetRoot, 'node.exe'))
  for (const name of ['npm.cmd', 'npx.cmd', 'npm', 'npx']) {
    await copyRequired(join(nodeSourceRoot, name), join(targetRoot, name))
  }
  await copyRequired(join(nodeSourceRoot, 'node_modules', 'npm'), join(targetRoot, 'node_modules', 'npm'))
  const version = execFileSync(nodeSource, ['--version'], { encoding: 'utf8' }).trim()
  const license = join(archiveRoot, `node-${version}-LICENSE`)
  await downloadFile(`https://raw.githubusercontent.com/nodejs/node/${version}/LICENSE`, license)
  await copyRequired(license, join(targetRoot, 'LICENSE'))
  return version
}

async function preparePython() {
  const sourceRoot = await extractPythonArchive()
  const targetRoot = join(runtimeRoot, 'python')
  await cp(sourceRoot, targetRoot, { recursive: true, force: true })
  const pthPath = join(targetRoot, 'python312._pth')
  const pth = (await readFile(pthPath, 'utf8'))
    .replace(/^\.\s*$/m, '.\nLib/site-packages')
    .replace(/^#import site\s*$/m, 'import site')
  await writeFile(pthPath, `${pth.trimEnd()}\n`, 'utf8')

  // 旧实现从开发机复制 pip，漏掉 dist-info，还带入本机 __pycache__；仅验证
  // --version 看不出安装器元数据不完整。改为解包官方 wheel（含许可证和元数据），
  // 安装位置遵循 Python 的 Lib/site-packages 约定，避免装完依赖后无法 import。
  await downloadFile(pipWheelUrl, pipWheel)
  if (createHash('sha256').update(await readFile(pipWheel)).digest('hex') !== pipSha256) {
    throw new Error('pip 发布文件校验不一致，请清理 tmp/plc-pilot-runtime-cache 中的 pip wheel 后重新构建。')
  }
  const sitePackages = join(targetRoot, 'Lib', 'site-packages')
  await mkdir(sitePackages, { recursive: true })
  execFileSync('tar.exe', ['-xf', pipWheel, '-C', sitePackages], { stdio: 'inherit' })
  const pythonExe = join(targetRoot, 'python.exe')
  const version = execFileSync(pythonExe, ['--version'], { encoding: 'utf8' }).trim()
  execFileSync(pythonExe, ['-B', '-m', 'pip', '--version'], {
    encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PYTHONUSERBASE: join(archiveRoot, 'python-user') },
  })
  return version
}

await rm(runtimeRoot, { recursive: true, force: true })
await mkdir(runtimeRoot, { recursive: true })
const nodeVersion = await prepareNode()
const pythonVersion = await preparePython()
await writeFile(join(runtimeRoot, 'runtime-manifest.json'), `${JSON.stringify({
  schema_version: 1,
  node: { version: nodeVersion, executable: 'node/node.exe', package_manager: 'node/npm.cmd', package_runner: 'node/npx.cmd' },
  python: { version: pythonVersion, executable: 'python/python.exe', package_manager: 'python/python.exe -m pip', distribution: 'embedded-stdlib-with-pip' },
  mcp_packages: '按需通过内置 npx 下载，未预装任何 MCP 包。',
  omitted: ['node_modules（除 npm 本身）', 'Python site-packages（除 pip）', 'CODESYS', 'WebView2'],
}, null, 2)}\n`, 'utf8')
console.log(`已准备发布运行时：${nodeVersion}；${pythonVersion}`)
