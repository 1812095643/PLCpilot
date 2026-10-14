import { createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const config = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const cargo = await readFile(join(root, 'src-tauri/Cargo.toml'), 'utf8')
if (config.version !== version || !cargo.includes(`version = "${version}"`)) throw new Error('Release versions are inconsistent')
if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== `v${version}` && process.env.GITHUB_REF_NAME !== 'main') throw new Error('Release ref does not match the package version')
const os = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform]
const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch]
const platform = `${os}-${arch}`
if (!['windows-x86_64', 'darwin-x86_64', 'darwin-aarch64', 'linux-x86_64'].includes(platform)) throw new Error(`Unsupported release platform: ${platform}`)
const destination = join(root, 'release-stage', platform)
await mkdir(destination, { recursive: true })
const platforms = {}
const artifacts = []
const bundle = join(root, 'src-tauri/target/release/bundle')

async function prepareAsset(source, name, key) {
  if (!existsSync(`${source}.sig`)) {
    execFileSync(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'signer', 'sign', source], { cwd: root, stdio: 'inherit', windowsHide: true })
  }
  const signature = (await readFile(`${source}.sig`, 'utf8')).trim()
  if (!signature) throw new Error(`Missing release signature: ${basename(source)}`)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(source)) hash.update(chunk)
  const sha256 = hash.digest('hex')
  const size = (await stat(source)).size
  await copyFile(source, join(destination, name))
  await copyFile(`${source}.sig`, join(destination, `${name}.sig`))
  artifacts.push({ name, sha256, size })
  const asset = { url: `https://github.com/1812095643/PLCpilot/releases/download/v${version}/${name}`, signature, sha256, size }
  if (key) platforms[key] = asset
  return asset
}

async function bundled(kind, extension) {
  const directory = join(bundle, kind)
  const files = (await readdir(directory)).filter(file => file.endsWith(extension))
  if (files.length !== 1) throw new Error(`Expected one ${extension} in ${directory}`)
  return join(directory, files[0])
}

if (os === 'windows') {
  platforms['windows-x86_64'] = await prepareAsset(await bundled('nsis', '.exe'), `PLC-Pilot-${version}-x64-setup.exe`, 'windows-x86_64-nsis')
  await prepareAsset(await bundled('msi', '.msi'), `PLC-Pilot-${version}-x64.msi`, 'windows-x86_64-msi')
  await prepareAsset(join(root, `output/PLC-Pilot-Portable-${version}-win-x64.zip`), `PLC-Pilot-Portable-${version}-win-x64.zip`, 'windows-x86_64-portable')
  const { version: stoneVersion } = JSON.parse(await readFile(join(root, 'stone-mcp/package.json'), 'utf8'))
  await prepareAsset(join(root, `output/PLC-Pilot-STone-MCP-${stoneVersion}.zip`), `PLC-Pilot-STone-MCP-${stoneVersion}.zip`)
} else if (os === 'darwin') {
  const name = `PLC-Pilot-${version}-macos-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
  await prepareAsset(await bundled('macos', '.app.tar.gz'), `${name}.app.tar.gz`, platform)
  await prepareAsset(await bundled('dmg', '.dmg'), `${name}.dmg`)
} else {
  await prepareAsset(await bundled('appimage', '.AppImage'), `PLC-Pilot-${version}-linux-x64.AppImage`, platform)
  await prepareAsset(await bundled('deb', '.deb'), `PLC-Pilot-${version}-linux-x64.deb`)
}
await writeFile(join(destination, `${platform}.json`), `${JSON.stringify({ version, platform, platforms, artifacts }, null, 2)}\n`)
console.log(`Staged ${platform} release: ${destination}`)
