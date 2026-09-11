import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const config = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const cargo = await readFile(join(root, 'src-tauri/Cargo.toml'), 'utf8')
if (config.version !== version || !cargo.includes(`version = "${version}"`)) throw new Error('前端、Tauri、Rust 的发布版本必须一致。')
if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== `v${version}`) throw new Error('发布标签必须与 package.json 中的版本一致。')

const destination = join(root, 'release-stage', version)
await mkdir(destination, { recursive: true })
const notes = (await readFile(join(root, 'release-notes.md'), 'utf8')).trim()
const manifest = { version, notes, pub_date: new Date().toISOString(), platforms: {} }
const checksums = []
async function prepareAsset(source, name) {
  const signature = (await readFile(`${source}.sig`, 'utf8')).trim()
  if (!signature) throw new Error(`发布文件未签名：${basename(source)}`)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(source)) hash.update(chunk)
  const sha256 = hash.digest('hex')
  await copyFile(source, join(destination, name))
  await copyFile(`${source}.sig`, join(destination, `${name}.sig`))
  checksums.push(`${sha256}  ${name}`)
  return { url: `https://github.com/1812095643/PLCpilot/releases/download/v${version}/${name}`, signature, sha256, size: (await stat(source)).size }
}
async function installer(kind, extension, name) {
  const directory = join(root, 'src-tauri/target/release/bundle', kind)
  const files = (await readdir(directory)).filter(file => file.endsWith(extension) && file.includes(`_${version}_`))
  if (files.length !== 1) throw new Error(`${kind} 安装文件数量不正确，请清理本次构建目录后重试。`)
  return prepareAsset(join(directory, files[0]), name)
}
manifest.platforms['windows-x86_64-nsis'] = await installer('nsis', '.exe', `PLC-Pilot-${version}-x64-setup.exe`)
manifest.platforms['windows-x86_64-msi'] = await installer('msi', '.msi', `PLC-Pilot-${version}-x64.msi`)
manifest.platforms['windows-x86_64'] = manifest.platforms['windows-x86_64-nsis']
manifest.platforms['windows-x86_64-portable'] = await prepareAsset(join(root, `output/PLC-Pilot-Portable-${version}-win-x64.zip`), `PLC-Pilot-Portable-${version}-win-x64.zip`)
const { version: stoneVersion } = JSON.parse(await readFile(join(root, 'stone-mcp/package.json'), 'utf8'))
await prepareAsset(join(root, `output/PLC-Pilot-STone-MCP-${stoneVersion}.zip`), `PLC-Pilot-STone-MCP-${stoneVersion}.zip`)
await writeFile(join(destination, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(join(destination, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`)
console.log(`已生成 ${version} 的安装版、便携版及签名更新清单。`)
