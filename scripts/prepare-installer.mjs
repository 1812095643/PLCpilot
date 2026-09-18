import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const windowsRoot = join(root, 'src-tauri/windows')
const configuration = JSON.parse(await readFile(join(windowsRoot, 'installer-strings.json'), 'utf8'))
const cli = JSON.parse(await readFile(join(root, 'node_modules/@tauri-apps/cli/package.json'), 'utf8'))
if (cli.version !== configuration.upstream.version) throw new Error('Review the installer template when upgrading the Tauri CLI.')
const cacheRoot = join(root, 'tmp/installer-template-cache')
await mkdir(cacheRoot, { recursive: true })
async function loadTemplate(extension, url, hash) {
  const sourcePath = join(cacheRoot, `tauri-cli-${cli.version}.${extension}`)
  let source
  try { source = await readFile(sourcePath) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    const response = await fetch(url, { signal: AbortSignal.timeout(45000) })
    if (!response.ok) throw new Error(`Installer template download returned HTTP ${response.status}`)
    source = Buffer.from(await response.arrayBuffer())
  }
  if (createHash('sha256').update(source).digest('hex') !== hash) throw new Error('Installer template checksum mismatch.')
  await writeFile(sourcePath, source)
  return source.toString('utf8').replaceAll('\r\n', '\n')
}
const generatedRoot = join(windowsRoot, 'generated')
await mkdir(generatedRoot, { recursive: true })
const finishHook = join(windowsRoot, 'finish-options.nsh')
let template = await loadTemplate('nsi', configuration.upstream.url, configuration.upstream.sha256)
const finishAnchor = '!insertmacro MUI_PAGE_FINISH\n'
const initAnchor = 'Function .onInit\n'
if (template.split(finishAnchor).length !== 2 || template.split(initAnchor).length !== 2) throw new Error('Installer callback locations changed.')
template = template.replace(finishAnchor, `!define MUI_FINISHPAGE_RUN_TEXT "$(PlcRunNow)"\n!define MUI_PAGE_CUSTOMFUNCTION_SHOW PlcFinishShow\n!define MUI_PAGE_CUSTOMFUNCTION_LEAVE PlcFinishLeave\n${finishAnchor}!include "${finishHook}"\n`)
  .replace(initAnchor, `${initAnchor}  Call PlcRememberStartup\n`)
await writeFile(join(generatedRoot, 'installer.nsi'), template)
const escapeNsis = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"').replaceAll('\r', '').replaceAll('\n', '$\\r$\\n')
const languageLines = Object.entries(configuration.languages).flatMap(([language, strings]) =>
  Object.entries(strings).map(([key, value]) => `LangString ${key} ${language} "${escapeNsis(value)}"`))
await writeFile(join(generatedRoot, 'installer-language.nsh'), languageLines.join('\n') + '\n')
let msiTemplate = await loadTemplate('wxs', configuration.upstream.msiUrl, configuration.upstream.msiSha256)
const desktopAnchor = '<Component Id="ApplicationShortcutDesktop" Guid="*">'
if (msiTemplate.split(desktopAnchor).length !== 2) throw new Error('MSI shortcut component location changed.')
msiTemplate = msiTemplate.replace(desktopAnchor, `${desktopAnchor}\n                    <Condition><![CDATA[UILevel <= 3 AND PLC_CREATE_DESKTOP = "1"]]></Condition>`)
await writeFile(join(generatedRoot, 'installer.wxs'), msiTemplate)
console.log('Prepared Tauri installer finish-page callbacks.')
