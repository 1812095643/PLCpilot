import { open, stat } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { requireAbsolutePath } from './runtime.mjs'

const exitCodes = {
  build: { '-1': '解决方案文件不存在', '-2': '加载解决方案未完成', '-3': '后台编译未通过', '-4': '重新编译未通过', '-5': '项目不存在', '-6': '配置不存在', '-7': 'STone 许可不可用', '-8': '输出目录不存在', '-9': '目标连接字符串不正确', '-10': 'STone 许可不可用', '-11': '测试未通过', '-12': '应用下载未完成', '-13': '目标连接未建立' },
  'unit-tests': { '-1': 'STone 许可不可用', '-2': '解决方案文件不存在', '-3': '加载解决方案未完成', '-4': '项目不存在', '-5': '项目编译未通过', '-6': '单元测试编译未通过', '-7': '项目没有单元测试', '-8': '目标连接未建立', '-9': '下载未完成', '-10': '测试未通过', '-11': '未知运行问题', '-12': '覆盖率未达到最低要求' },
  'export-workspace': { '-1': 'Spark 文件不存在', '-2': '无法创建输出目录', '-3': '工作区导出未完成' },
  'activate-license': { '-1': '连接或许可资料不正确', '-2': '连接或 NVL 许可资料不正确', '-3': '已取消', '-5': '缺少子命令', '-7': '国家值不正确', '-8': '许可不包含 STone 功能' },
  'activate-license-offline': { '-4': '离线许可不可用', '-5': '许可文件不正确', '-8': '许可不包含 STone 功能' },
  'iron-python': { '-1': 'STone 许可不可用', '-2': 'Python 脚本文件不存在', '-3': 'Python 脚本抛出异常' },
}

export function exitMeaning(command, code) {
  if (code === 0) return '官方 CLI 执行完成'
  return (exitCodes[command === 'automatic-test' ? 'build' : command] ?? {})[String(code)] ?? `官方 CLI 返回退出码 ${code}，请查看原始输出。`
}

/** 只映射资料中存在的命令和参数，禁止附加任意 CLI/Python 参数。 */
export function cliArguments(command, input) {
  const args = []
  const add = (flag, value) => { if (value !== undefined) args.push(flag, ...(Array.isArray(value) ? value : [String(value)])) }
  if (['build', 'automatic-test', 'unit-tests'].includes(command)) {
    args.push(command)
    add('-s', requireAbsolutePath(input.solutionPath, { extension: '.stone' }))
    add('-p', input.projectName)
    if (command !== 'unit-tests') add('-c', input.configurationName)
    add('-n', input.connectionString)
    if (command === 'build') {
      if (input.metadata === 'enable') args.push('--enable-metadata-file')
      if (input.metadata === 'disable') args.push('--disable-metadata-file')
    }
    if (command === 'unit-tests') {
      if ((input.coveragePath !== undefined || input.minimumCoverage !== undefined) && !input.codeCoverage) throw new Error('设置覆盖率报告或最低覆盖率时，请同时设置 codeCoverage=true。')
      for (const path of [input.reportPath, input.coveragePath].filter(Boolean)) {
        requireAbsolutePath(path, { exists: false, extension: '.xml' })
        requireAbsolutePath(dirname(path), { directory: true })
      }
      add('-r', input.reportPath)
      if (input.codeCoverage) args.push('--code-coverage')
      add('-c', input.coveragePath); add('-m', input.minimumCoverage); add('--log-level', input.logLevel)
    }
  } else if (command === 'export-workspace') {
    args.push(command, '--s', requireAbsolutePath(input.sparkPath, { extension: '.spark' }), '--o', requireAbsolutePath(input.outputDirectory, { exists: false }))
    if (input.all && ['configurations', 'languages', 'profiles', 'allConfigurations', 'allLanguages', 'allProfiles'].some(key => input[key])) throw new Error('all=true 时不应再指定配置、语言或 Profile 筛选。')
    for (const [list, all] of [['configurations', 'allConfigurations'], ['languages', 'allLanguages'], ['profiles', 'allProfiles']]) {
      if (input[list] && input[all]) throw new Error(`${list} 与 ${all} 只能选择一种。`)
    }
    for (const [flag, key] of [['-a', 'all'], ['-e', 'allConfigurations'], ['-f', 'allLanguages'], ['-g', 'allProfiles']]) if (input[key]) args.push(flag)
    for (const [flag, key] of [['--c', 'configurations'], ['-l', 'languages'], ['-p', 'profiles'], ['-d', 'documents']]) add(flag, input[key])
    for (const path of input.documents ?? []) requireAbsolutePath(path)
  } else if (command === 'iron-python') {
    args.push(command, '-f', requireAbsolutePath(input.scriptPath, { extension: '.py' }))
    if (input.scriptArgs?.length) add('-a', input.scriptArgs)
  } else if (command === 'hardware-id') args.push('activate-license', '--show-hardware-id')
  else if (command === 'activate-license') {
    args.push(command)
    for (const [flag, key] of [['--serial-number', 'serialNumber'], ['--company', 'company'], ['--address', 'address'], ['--country', 'country']]) add(flag, input[key])
  } else if (command === 'activate-license-offline') args.push('activate-license', '--filename', requireAbsolutePath(input.licensePath, { extension: '.jlic' }))
  else throw new Error('该 CLI 命令不在官方接口清单内。')
  return args
}

export function validateMethodPaths(definition, input) {
  const key = `${definition.method.receiver}.${definition.member}`
  const fileFields = ['sourceFilePath', 'filePath', 'stlibPath', 'fileName']
  for (const name of fileFields) if (input[name] !== undefined) requireAbsolutePath(input[name])
  if (key === 'Solution.Open') requireAbsolutePath(input.solutionPath, { extension: '.stone' })
  if (key.startsWith('Solution.CreateNew')) {
    requireAbsolutePath(input.baseDir, { directory: true })
    const name = input.name ?? input.projectName
    if (!name || /[\\/<>:"|?*\x00-\x1f]/.test(name) || ['.', '..'].includes(name) || /[. ]$/.test(name)) throw new Error('新建名称请使用单个合法文件夹名称，不要包含路径。')
  }
  if (input.relativeDestinationPath !== undefined && (isAbsolute(input.relativeDestinationPath) || input.relativeDestinationPath.split(/[\\/]/).includes('..'))) throw new Error('项目内目标路径需要是相对路径，不能包含上级目录。')
  if (key === 'Project.RenameFile' && (/[\\/<>:"|?*\x00-\x1f]/.test(input.newName) || ['.', '..'].includes(input.newName))) throw new Error('新文件名不能包含路径或特殊字符。')
}

export const redact = (value, input) => {
  let text = String(value)
  for (const secret of [input.serialNumber, input.company, input.address].filter(Boolean)) text = text.split(secret).join('[已隐藏]')
  return text
}

export async function runCliTool(runtime, definition, input, options) {
  const args = cliArguments(definition.command, input)
  const paths = [input.reportPath, input.coveragePath].filter(Boolean)
  const before = new Map(await Promise.all(paths.map(async path => [path, await stat(path).catch(() => null)])))
  const output = await runtime.cli(args, { ...options, timeoutMs: input.timeoutMs, onOutput: (text, kind) => options.onOutput?.(redact(text, input), kind) })
  const reports = []
  for (const path of paths) {
    const after = await stat(path).catch(() => null), previous = before.get(path)
    // 失败的运行可能留下上一次报告；不能把旧报告说成刚刚生成的测试结果。
    const updated = after && (!previous || after.mtimeMs !== previous.mtimeMs || after.size !== previous.size)
    let text = ''
    if (updated) {
      const handle = await open(path, 'r')
      try { const buffer = Buffer.alloc(Math.min(after.size, 64000)); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); text = buffer.subarray(0, bytesRead).toString('utf8') } finally { await handle.close() }
    }
    reports.push({ path, updated: Boolean(updated), bytes: after?.size ?? 0, truncated: updated && after.size > 64000, text })
  }
  return { ...output, command: definition.command, args: args.map(value => redact(value, input)), stdout: redact(output.stdout, input), stderr: redact(output.stderr, input),
    succeeded: output.exitCode === 0, message: exitMeaning(definition.command, output.exitCode), reports }
}
