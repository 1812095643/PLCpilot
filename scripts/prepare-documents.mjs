import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, copyFile, readdir, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'runtime-stage', 'pdf')
const cache = join(root, 'tmp', 'plc-pilot-runtime-cache', 'pdfium-8066')
const archive = join(cache, 'pdfium-win-x64.tgz')
const checksum = '739a57d597d864297909cc40a2411eba728490c76a0fa25e3ea299c7f6b07020'
await mkdir(cache, { recursive: true })
await mkdir(target, { recursive: true })
if (!existsSync(archive)) {
  const response = await fetch('https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/8066/pdfium-win-x64.tgz', { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`PDFium download HTTP ${response.status}`)
  await writeFile(archive, Buffer.from(await response.arrayBuffer()))
}
if (createHash('sha256').update(await readFile(archive)).digest('hex') !== checksum) throw new Error('PDFium SHA256 mismatch')
execFileSync('tar.exe', ['-xf', archive, '-C', cache], { windowsHide: true })
await copyFile(join(cache, 'bin', 'pdfium.dll'), join(target, 'pdfium.dll'))
for (const entry of await readdir(cache, { withFileTypes: true })) {
  if (entry.isFile() && /^(LICENSE|NOTICE)/i.test(entry.name)) await copyFile(join(cache, entry.name), join(target, entry.name))
}
const licenseRoot = join(cache, 'licenses')
if (existsSync(licenseRoot)) {
  await cp(licenseRoot, join(target, 'licenses'), { recursive: true })
}
await writeFile(join(target, 'version.json'), JSON.stringify({ version: 'chromium/8066', sha256: checksum }, null, 2))
const manifestPath = join(root, 'runtime-stage', 'runtime-manifest.json')
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.pdf = { version: 'chromium/8066', executable: 'pdf/pdfium.dll', sha256: checksum }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}
process.stdout.write('PDFium runtime ready\n')
