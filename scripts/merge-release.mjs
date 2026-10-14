import { createReadStream } from 'node:fs'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const directory = resolve(process.argv[2] || join(root, 'release-stage'))
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const expected = ['windows-x86_64', 'darwin-x86_64', 'darwin-aarch64', 'linux-x86_64']
const manifest = { version, notes: (await readFile(join(root, 'release-notes.md'), 'utf8')).trim(), pub_date: new Date().toISOString(), platforms: {} }
const checksums = new Map()
for (const platform of expected) {
  const part = JSON.parse(await readFile(join(directory, `${platform}.json`), 'utf8'))
  if (part.version !== version || part.platform !== platform || !part.platforms[platform]) throw new Error(`Incomplete release: ${platform}`)
  if (platform === 'windows-x86_64' && !part.platforms['windows-x86_64-portable']) throw new Error('Missing Windows portable update')
  for (const item of part.artifacts) {
    if (basename(item.name) !== item.name || checksums.has(item.name)) throw new Error(`Invalid or duplicate artifact: ${item.name}`)
    const file = join(directory, item.name)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    const sha256 = hash.digest('hex')
    if (sha256 !== item.sha256 || (await stat(file)).size !== item.size) throw new Error(`Artifact mismatch: ${item.name}`)
    if (!(await readFile(`${file}.sig`, 'utf8')).trim()) throw new Error(`Artifact is unsigned: ${item.name}`)
    checksums.set(item.name, sha256)
  }
  for (const [key, asset] of Object.entries(part.platforms)) {
    const url = new URL(asset.url)
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith(`/1812095643/PLCpilot/releases/download/v${version}/`)) throw new Error(`Invalid release URL: ${key}`)
    const name = decodeURIComponent(url.pathname.split('/').at(-1))
    if (checksums.get(name) !== asset.sha256 || (await readFile(join(directory, `${name}.sig`), 'utf8')).trim() !== asset.signature) throw new Error(`Invalid update metadata: ${key}`)
    if (manifest.platforms[key]) throw new Error(`Duplicate update target: ${key}`)
    manifest.platforms[key] = asset
  }
}
await writeFile(join(directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(join(directory, 'SHA256SUMS.txt'), `${[...checksums].map(([name, hash]) => `${hash}  ${name}`).join('\n')}\n`)
console.log(`Verified ${checksums.size} packages for ${Object.keys(manifest.platforms).length} updater targets`)
