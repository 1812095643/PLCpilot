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
const patentRequirements = join(projectRoot, 'scripts', 'patent-runtime-requirements.txt')

async function copyRequired(source, target) {
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { recursive: true, force: true })
}

async function downloadFile(url, target) {
  await mkdir(archiveRoot, { recursive: true })
  if (existsSync(target)) return
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`Runtime download failed: HTTP ${response.status} (${url})`)
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

  await downloadFile(pipWheelUrl, pipWheel)
  if (createHash('sha256').update(await readFile(pipWheel)).digest('hex') !== pipSha256) {
    throw new Error('pip wheel checksum mismatch. Remove the cached pip wheel and rebuild.')
  }
  const sitePackages = join(targetRoot, 'Lib', 'site-packages')
  await mkdir(sitePackages, { recursive: true })
  execFileSync('tar.exe', ['-xf', pipWheel, '-C', sitePackages], { stdio: 'inherit' })
  const pythonExe = join(targetRoot, 'python.exe')
  const version = execFileSync(pythonExe, ['--version'], { encoding: 'utf8' }).trim()
  execFileSync(pythonExe, ['-B', '-m', 'pip', '--version'], {
    encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PYTHONUSERBASE: join(archiveRoot, 'python-user') },
  })
  execFileSync(pythonExe, [
    '-B', '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--no-compile',
    '--only-binary=:all:', '--require-hashes', '--target', sitePackages, '--requirement', patentRequirements,
  ], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PYTHONUSERBASE: join(archiveRoot, 'python-user'),
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONNOUSERSITE: '1',
      PIP_USER: '0',
      PIP_CACHE_DIR: join(archiveRoot, 'pip-cache'),
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
    },
  })
  execFileSync(pythonExe, ['-B', '-s', '-c', 'import docx, latex2mathml, yaml, playwright, mammoth, pptx, PIL, xlsxwriter; print("Patent skill core imports passed")'], { stdio: 'inherit' })
  return version
}

await rm(runtimeRoot, { recursive: true, force: true })
await mkdir(runtimeRoot, { recursive: true })
const nodeVersion = await prepareNode()
const pythonVersion = await preparePython()
await writeFile(join(runtimeRoot, 'runtime-manifest.json'), `${JSON.stringify({
  schema_version: 1,
  node: { version: nodeVersion, executable: 'node/node.exe', package_manager: 'node/npm.cmd', package_runner: 'node/npx.cmd' },
  python: { version: pythonVersion, executable: 'python/python.exe', package_manager: 'python/python.exe -m pip', distribution: 'embedded-stdlib-with-pip', patent_skill_core_dependencies: ['python-docx', 'latex2mathml', 'PyYAML', 'playwright', 'mammoth', 'python-pptx', 'Pillow', 'XlsxWriter'] },
  mcp_packages: 'Installed on demand with bundled npx.',
  omitted: ['node_modules except npm', 'optional patent PDF/CAD/math packages', 'Playwright browser binaries', 'vector models', 'CODESYS', 'WebView2'],
}, null, 2)}\n`, 'utf8')
console.log(`Prepared release runtime: ${nodeVersion}; ${pythonVersion}`)
