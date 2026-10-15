import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function notesForVersion(content, version) {
  const expected = version.replace(/^v/, '')
  const sections = [...content.matchAll(/^(?:#{1,6}\s+)?v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?=\s|$)[^\r\n]*$/gm)]
  const index = sections.findIndex(section => section[1] === expected)
  if (index < 0) throw new Error('Release notes do not contain version ' + expected)
  return content.slice(sections[index].index, sections[index + 1]?.index ?? content.length)
    .trim().replace(/(?:\r?\n\s*---\s*)+$/, '').trim()
}

export async function currentReleaseNotes(root) {
  const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  return notesForVersion(await readFile(resolve(root, 'release-notes.md'), 'utf8'), version)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..')
  const args = process.argv.slice(2)
  const versionIndex = args.indexOf('--version')
  const outputIndex = args.indexOf('--output')
  const notes = versionIndex >= 0
    ? notesForVersion(await readFile(resolve(root, 'release-notes.md'), 'utf8'), args[versionIndex + 1])
    : await currentReleaseNotes(root)
  if (outputIndex >= 0) await writeFile(resolve(args[outputIndex + 1]), notes + '\n')
  else process.stdout.write(notes + '\n')
}
