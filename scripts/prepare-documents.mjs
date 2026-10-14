import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, copyFile, readdir, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const platforms = {
  'win32-x64': ['win-x64', 'bin/pdfium.dll', '739a57d597d864297909cc40a2411eba728490c76a0fa25e3ea299c7f6b07020'],
  'darwin-arm64': ['mac-arm64', 'lib/libpdfium.dylib', '336219e80580b93c6523f44db7dc1de59cc497b13a7390ddac84223f68ca162b'],
  'darwin-x64': ['mac-x64', 'lib/libpdfium.dylib', '841ecac278cdd46288dd065873522cf72f3996560d8978f473d336f01d59942c'],
  'linux-x64': ['linux-x64', 'lib/libpdfium.so', '0b43f405477cf2cfc4dbff06905093c3309756c6bca1fb9da99234a2ca97fed2'],
}
const platform = platforms[`${process.platform}-${process.arch}`]
if (!platform) throw new Error(`Unsupported PDFium runtime: ${process.platform}-${process.arch}`)
const [name, library, checksum] = platform
const target = join(root, 'runtime-stage', 'pdf')
const cache = join(root, 'tmp', 'plc-pilot-runtime-cache', `pdfium-8066-${name}`)
const archive = join(cache, `pdfium-${name}.tgz`)
await mkdir(cache, { recursive: true })
await mkdir(target, { recursive: true })
if (!existsSync(archive)) {
  const response = await fetch(`https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/8066/pdfium-${name}.tgz`, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`PDFium download HTTP ${response.status}`)
  await writeFile(archive, Buffer.from(await response.arrayBuffer()))
}
if (createHash('sha256').update(await readFile(archive)).digest('hex') !== checksum) throw new Error('PDFium SHA256 mismatch')
execFileSync(process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar', ['-xf', archive, '-C', cache], { windowsHide: true })
const filename = library.split('/').at(-1)
await copyFile(join(cache, library), join(target, filename))
for (const entry of await readdir(cache, { withFileTypes: true })) {
  if (entry.isFile() && /^(LICENSE|NOTICE)/i.test(entry.name)) await copyFile(join(cache, entry.name), join(target, entry.name))
}
if (existsSync(join(cache, 'licenses'))) await cp(join(cache, 'licenses'), join(target, 'licenses'), { recursive: true })
await writeFile(join(target, 'version.json'), JSON.stringify({ version: 'chromium/8066', platform: name, sha256: checksum }, null, 2))
const manifestPath = join(root, 'runtime-stage', 'runtime-manifest.json')
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.pdf = { version: 'chromium/8066', executable: `pdf/${filename}`, sha256: checksum }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}
process.stdout.write(`PDFium runtime ready: ${name}\n`)
