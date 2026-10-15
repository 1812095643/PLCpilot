import { createReadStream } from 'node:fs'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { currentReleaseNotes } from './release-notes.mjs'

const root = resolve(import.meta.dirname, '..')
const directory = resolve(process.argv[2] || join(root, 'release-stage'))
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const configuration = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const keyText = Buffer.from(configuration.plugins.updater.pubkey, 'base64').toString('utf8').trim().split(/\r?\n/)
const rawKey = Buffer.from(keyText[1], 'base64')
if (rawKey.length !== 42 || rawKey.subarray(0, 2).toString() !== 'Ed') throw new Error('Invalid updater public key')
const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey.subarray(10)]), format: 'der', type: 'spki' })
const expected = ['windows-x86_64', 'darwin-x86_64', 'darwin-aarch64', 'linux-x86_64']
const manifest = { version, notes: await currentReleaseNotes(root), pub_date: new Date().toISOString(), platforms: {} }
const checksums = new Map()
for (const platform of expected) {
  const part = JSON.parse(await readFile(join(directory, `${platform}.json`), 'utf8'))
  if (part.version !== version || part.platform !== platform || !part.platforms[platform]) throw new Error(`Incomplete release: ${platform}`)
  if (platform === 'windows-x86_64' && !part.platforms['windows-x86_64-portable']) throw new Error('Missing Windows portable update')
  for (const item of part.artifacts) {
    if (basename(item.name) !== item.name || checksums.has(item.name)) throw new Error(`Invalid or duplicate artifact: ${item.name}`)
    const file = join(directory, item.name)
    const hash = createHash('sha256')
    const signedHash = createHash('blake2b512')
    for await (const chunk of createReadStream(file)) { hash.update(chunk); signedHash.update(chunk) }
    const sha256 = hash.digest('hex')
    if (sha256 !== item.sha256 || (await stat(file)).size !== item.size) throw new Error(`Artifact mismatch: ${item.name}`)
    const signatureText = (await readFile(`${file}.sig`, 'utf8')).trim()
    const lines = Buffer.from(signatureText, 'base64').toString('utf8').trim().split(/\r?\n/)
    const signature = Buffer.from(lines[1] || '', 'base64')
    if (signature.length !== 74 || signature.subarray(0, 2).toString() !== 'ED' || !signature.subarray(2, 10).equals(rawKey.subarray(2, 10))) throw new Error(`Invalid signing identity: ${item.name}`)
    if (!verify(null, signedHash.digest(), publicKey, signature.subarray(10))) throw new Error(`Artifact signature failed: ${item.name}`)
    if (!lines[2]?.startsWith('trusted comment: ') || !verify(null, Buffer.concat([signature.subarray(10), Buffer.from(lines[2].slice(17))]), publicKey, Buffer.from(lines[3] || '', 'base64'))) throw new Error(`Trusted comment signature failed: ${item.name}`)
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
