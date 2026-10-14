import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile, symlink, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = join(projectRoot, 'runtime-stage')
const archiveRoot = join(projectRoot, 'tmp', 'plc-pilot-runtime-cache')
const windows = process.platform === 'win32'
const tar = windows ? 'tar.exe' : 'tar'
const nodeSource = process.env.PLC_PILOT_NODE_SOURCE || process.execPath
const nodeSourceRoot = dirname(nodeSource)
const pipWheel = join(archiveRoot, 'pip-26.0.1-py3-none-any.whl')
const pipWheelUrl = 'https://files.pythonhosted.org/packages/de/f0/c81e05b613866b76d2d1066490adf1a3dbc4ee9d9c839961c3fc8a6997af/pip-26.0.1-py3-none-any.whl'
const pipSha256 = 'bdb1b08f4274833d62c1aa29e20907365a2ceb950410df15fc9521bad440122b'
const patentRequirements = join(projectRoot, 'scripts', 'patent-runtime-requirements.txt')
const standalone = {
  'darwin-arm64': ['aarch64-apple-darwin', '0be1fe0b35a4d3c382141764ef16ed3b8cc2b4620b657f678daa7b7f8df39699'],
  'darwin-x64': ['x86_64-apple-darwin', 'ad3bef94b6054adcf8e0a47886e21b00dfc6a37f22eea229cf0f8725bd0e1023'],
  'linux-x64': ['x86_64-unknown-linux-gnu', '8c59b9ac6bff2dc3934181d7bc82594f9f59a613afed8d72c9e89d7194e790ee'],
}

async function copyRequired(source, target) {
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { recursive: true, force: true, verbatimSymlinks: true })
}

async function downloadFile(url, target, checksum) {
  await mkdir(archiveRoot, { recursive: true })
  if (!existsSync(target)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) })
    if (!response.ok) throw new Error(`Runtime download failed: HTTP ${response.status} (${url})`)
    await writeFile(target, Buffer.from(await response.arrayBuffer()))
  }
  if (checksum && createHash('sha256').update(await readFile(target)).digest('hex') !== checksum) throw new Error(`Runtime checksum mismatch: ${target}`)
}

async function prepareNode() {
  const targetRoot = join(runtimeRoot, 'node')
  await copyRequired(nodeSource, join(targetRoot, windows ? 'node.exe' : 'node'))
  const npmSource = [join(nodeSourceRoot, 'node_modules', 'npm'), resolve(nodeSourceRoot, '../lib/node_modules/npm')].find(path => existsSync(join(path, 'bin/npm-cli.js')))
  if (!npmSource) throw new Error('Cannot locate the npm distribution beside Node.js')
  await copyRequired(npmSource, join(targetRoot, 'node_modules', 'npm'))
  if (windows) {
    for (const name of ['npm.cmd', 'npx.cmd', 'npm', 'npx']) await copyRequired(join(nodeSourceRoot, name), join(targetRoot, name))
  } else {
    await chmod(join(targetRoot, 'node'), 0o755)
    for (const name of ['npm', 'npx']) await symlink(`node_modules/npm/bin/${name}-cli.js`, join(targetRoot, name))
  }
  const version = execFileSync(nodeSource, ['--version'], { encoding: 'utf8' }).trim()
  const license = join(archiveRoot, `node-${version}-LICENSE`)
  await downloadFile(`https://raw.githubusercontent.com/nodejs/node/${version}/LICENSE`, license)
  await copyRequired(license, join(targetRoot, 'LICENSE'))
  return version
}

async function preparePython() {
  const targetRoot = join(runtimeRoot, 'python')
  if (windows) {
    const filename = 'python-3.12.10-embed-amd64.zip'
    const archive = join(archiveRoot, filename)
    await downloadFile(process.env.PLC_PILOT_PYTHON_EMBED_URL || `https://www.python.org/ftp/python/3.12.10/${filename}`, archive)
    await mkdir(targetRoot, { recursive: true })
    execFileSync(tar, ['-xf', archive, '-C', targetRoot], { stdio: 'inherit', windowsHide: true })
    const pthPath = join(targetRoot, 'python312._pth')
    const pth = (await readFile(pthPath, 'utf8')).replace(/^\.\s*$/m, '.\nLib/site-packages').replace(/^#import site\s*$/m, 'import site')
    await writeFile(pthPath, `${pth.trimEnd()}\n`, 'utf8')
    await downloadFile(pipWheelUrl, pipWheel, pipSha256)
    await mkdir(join(targetRoot, 'Lib/site-packages'), { recursive: true })
    execFileSync(tar, ['-xf', pipWheel, '-C', join(targetRoot, 'Lib/site-packages')], { stdio: 'inherit', windowsHide: true })
  } else {
    const distribution = standalone[`${process.platform}-${process.arch}`]
    if (!distribution) throw new Error(`Unsupported Python runtime: ${process.platform}-${process.arch}`)
    const filename = `cpython-3.12.10+20250409-${distribution[0]}-install_only_stripped.tar.gz`
    const archive = join(archiveRoot, filename)
    await downloadFile(`https://github.com/astral-sh/python-build-standalone/releases/download/20250409/${encodeURIComponent(filename)}`, archive, distribution[1])
    const extracted = join(archiveRoot, `python-${distribution[0]}`)
    await rm(extracted, { recursive: true, force: true })
    await mkdir(extracted, { recursive: true })
    execFileSync(tar, ['-xf', archive, '-C', extracted], { stdio: 'inherit' })
    await copyRequired(join(extracted, 'python'), targetRoot)
  }
  const pythonExe = join(targetRoot, windows ? 'python.exe' : 'bin/python3')
  const sitePackages = join(targetRoot, windows ? 'Lib/site-packages' : 'lib/python3.12/site-packages')
  const version = execFileSync(pythonExe, ['--version'], { encoding: 'utf8' }).trim()
  execFileSync(pythonExe, ['-B', '-m', 'pip', '--version'], { stdio: 'pipe', env: { ...process.env, PYTHONUSERBASE: join(archiveRoot, 'python-user') } })
  execFileSync(pythonExe, ['-B', '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--no-compile', '--only-binary=:all:', '--require-hashes', '--target', sitePackages, '--requirement', patentRequirements], {
    stdio: 'inherit',
    env: { ...process.env, PYTHONUSERBASE: join(archiveRoot, 'python-user'), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONNOUSERSITE: '1', PIP_USER: '0', PIP_CACHE_DIR: join(archiveRoot, 'pip-cache'), PIP_DISABLE_PIP_VERSION_CHECK: '1' },
  })
  execFileSync(pythonExe, ['-B', '-s', '-c', 'import docx, latex2mathml, yaml, playwright, mammoth, pptx, PIL, xlsxwriter; print("Office skill runtime imports passed")'], { stdio: 'inherit' })
  return version
}

await rm(runtimeRoot, { recursive: true, force: true })
await mkdir(runtimeRoot, { recursive: true })
const nodeVersion = await prepareNode()
const pythonVersion = await preparePython()
await writeFile(join(runtimeRoot, 'runtime-manifest.json'), `${JSON.stringify({
  schema_version: 1,
  platform: process.platform,
  arch: process.arch,
  node: { version: nodeVersion, executable: windows ? 'node/node.exe' : 'node/node', package_manager: windows ? 'node/npm.cmd' : 'node/npm', package_runner: windows ? 'node/npx.cmd' : 'node/npx' },
  python: { version: pythonVersion, executable: windows ? 'python/python.exe' : 'python/bin/python3', package_manager: windows ? 'python/python.exe -m pip' : 'python/bin/python3 -m pip', distribution: windows ? 'embedded-stdlib-with-pip' : 'python-build-standalone', patent_skill_core_dependencies: ['python-docx', 'latex2mathml', 'PyYAML', 'playwright', 'mammoth', 'python-pptx', 'Pillow', 'XlsxWriter'] },
  mcp_packages: 'Installed on demand with bundled npx.',
  omitted: ['node_modules except npm', 'optional patent PDF/CAD/math packages', 'Playwright browser binaries', 'vector models', 'CODESYS', 'WebView2'],
}, null, 2)}\n`, 'utf8')
console.log(`Prepared release runtime: ${nodeVersion}; ${pythonVersion}; ${process.platform}-${process.arch}`)
