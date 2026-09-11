import { readFileSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const compressed = new URL('./data/official-api.json.gz', import.meta.url)
const bytes = existsSync(compressed) ? gunzipSync(readFileSync(compressed)) : readFileSync(new URL('./data/official-api.json', import.meta.url))
export const officialApi = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
export const desktopPages = officialApi.desktopAutomation.officialPages
export const methods = desktopPages.flatMap(page => page.methods.map(method => ({ ...method, receiver: page.title })))

/** 保留官方 sourceId；重载按完整签名区分，不按函数名去重而遗漏重载。 */
export const references = [
  ...methods.map(item => ({ ...item, surface: 'desktop', kind: 'method', namespace: item.receiver })),
  ...officialApi.controllerStructuredTextApi.allItems.map(item => ({ ...item, surface: 'controller' })),
  ...officialApi.sourcePages.help.map(item => ({ ...item, surface: 'help', kind: 'page', name: item.title })),
  ...officialApi.sourcePages.api.map(item => ({ ...item, surface: 'controller', kind: 'page', name: item.title })),
]
export const referenceById = new Map(references.map(item => [item.sourceId, item]))
if (methods.length !== 33 || officialApi.controllerStructuredTextApi.allItems.length !== 1138 || referenceById.size !== references.length) {
  throw new Error('官方接口资料的数量或 sourceId 不一致，请重新核对官方 JSON。')
}

export const textSchema = (description, extra = {}) => ({ type: 'string', minLength: 1, maxLength: 32768, description, ...extra })
export const objectSchema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const booleanSchema = description => ({ type: 'boolean', description })
const integerSchema = (description, minimum, maximum) => ({ type: 'integer', minimum, maximum, description })
export const timeoutSchema = integerSchema('调用超时毫秒；超时将关闭当前 CLI 进程，不重放操作。默认 90000。', 1000, 3600000)
const snake = value => value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/\s+/g, '_').toLowerCase()

const methodTitles = {
  'Solution.Open': '打开解决方案', 'Solution.Close': '关闭解决方案', 'Solution.Save': '保存解决方案',
  'Solution.SetActiveProject': '选择活动项目', 'Solution.CreateNewProject': '创建项目', 'Solution.CreateNewSolution': '创建解决方案',
  'Solution.AddExistingProject': '加入已有项目', 'Solution.RemoveProject': '移除项目', 'Solution.Build': '编译解决方案并返回官方诊断',
  'Solution.SetActiveSolutionConfiguration': '选择解决方案配置',
  'Project.AddFile': '添加文件', 'Project.RemoveFile': '删除项目文件', 'Project.ExcludeFileFromProject': '从项目排除文件',
  'Project.RenameFile': '重命名项目文件', 'Project.AddLibrary': '添加库', 'Project.CloseProject': '关闭项目',
  'Project.GetOrCreateLibsFolder': '获取或创建库目录', 'Project.GetLibsNames': '列出项目库',
  'Project.GetFolderRelativePaths': '列出项目目录', 'Project.GetOutputDir': '获取编译输出目录',
  'Project.SetActiveProjectConfiguration': '选择项目配置',
  'Target.StartSimulator': '启动模拟器', 'Target.StopSimulator': '停止模拟器', 'Target.Connect': '连接目标',
  'Target.Disconnect': '断开目标', 'Target.Restart': '重启目标', 'Target.Download': '下载已编译应用至目标',
  'Target.CreateWatch': '建立变量监视句柄', 'Target.StartStopDeviceRecover': '切换设备恢复状态', 'Target.ClearBinaries': '清除目标应用',
  'Watch.ReadValue': '读取监视变量', 'Watch.WriteValue': '写入监视变量', 'Task.SetActive': '切换活动任务',
}
const readMethods = new Set(['Project.GetLibsNames', 'Project.GetFolderRelativePaths', 'Project.GetOutputDir', 'Watch.ReadValue'])

/** 只解析文档明示的缺省值。参数表与签名不一致时（CreateWatch）仍按表的顺序传位置参数。 */
function parameterSchema(parameter, signature) {
  const schema = parameter.type === 'bool' ? booleanSchema(parameter.description) : textSchema(parameter.description)
  const match = signature.match(new RegExp(`\\b${parameter.name}\\s*=\\s*("[^"]*"|'[^']*'|true|false)`, 'i'))
  if (match) {
    const raw = match[1]
    schema.default = /^(true|false)$/i.test(raw) ? raw.toLowerCase() === 'true' : raw.slice(1, -1)
    if (schema.default === '') schema.minLength = 0
  }
  if (parameter.type.endsWith('Configuration')) schema.description = `已有配置的 Name；适配器从官方集合选择真实对象。${parameter.description}`
  return schema
}

function tool(name, title, description, properties, required, handler, readOnly = false, extra = {}) {
  return {
    name, title, description, inputSchema: objectSchema(properties, required),
    annotations: { title, readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: true },
    handler, ...extra,
  }
}

export const methodTools = methods.map(method => {
  const member = method.signature.split('(')[0]
  const key = `${method.receiver}.${member}`
  const properties = Object.fromEntries(method.parameters.map(parameter => [parameter.name, parameterSchema(parameter, method.signature)]))
  const required = method.parameters.filter(parameter => !('default' in properties[parameter.name])).map(parameter => parameter.name)
  if (method.receiver === 'Project') { properties.projectName = textSchema('解决方案中已有项目的 Name。'); required.push('projectName') }
  if (method.receiver === 'Watch') { properties.watchId = textSchema('stone_target_create_watch 返回的当前会话句柄。'); required.push('watchId') }
  if (method.receiver === 'Task') { properties.taskName = textSchema('stone_target_inspect 返回的任务 Name。'); required.push('taskName') }
  properties.timeoutMs = timeoutSchema
  return tool(`stone_${snake(method.receiver)}_${snake(member)}`, methodTitles[key],
    `${methodTitles[key]}。官方 ${method.receiver}.${method.signature}。${method.description}\n返回：${method.returns || '以官方返回值为准。'}\n${member === 'CreateNewSolution' ? '创建后必须用返回的 solutionPath 调用 stone_solution_open。' : '复用当前 MCP 会话；先打开解决方案，目标操作按文档先连接/编译。'}`,
    properties, required, 'method', readMethods.has(key), { method, member, sourceId: method.sourceId })
})

const projectSelector = { projectName: textSchema('解决方案中的项目名称。') }
const configurationSelector = { ...projectSelector, configurationName: textSchema('项目配置的 Name。') }
export const propertyFields = {
  Project: desktopPages.find(page => page.title === 'Project').fields.filter(field => ['Author', 'Vendor', 'GenerateMetadataFile'].includes(field.name)),
  ProjectConfiguration: desktopPages.find(page => page.title === 'Project Configuration').fields,
}
const propertySchema = fields => objectSchema(Object.fromEntries(fields.map(field => [field.name, field.type === 'bool' ? booleanSchema(field.description) : textSchema(field.description, { minLength: 0 })])))
const projectArgs = { solutionPath: textSchema('现有 .stone 解决方案绝对路径。'), projectName: textSchema('项目名称。') }
const configuredProjectArgs = { ...projectArgs, configurationName: textSchema('编译配置名称。') }
const stringList = description => ({ type: 'array', items: textSchema(description), minItems: 1, maxItems: 100, description })

export const tools = [
  tool('stone_environment', '检查 STone 环境', '检查 SToneCLI 路径和完整官方接口覆盖情况；不启动 STone，不需要许可证。可用 STONE_CLI_PATH 指定安装路径。', {}, [], 'environment', true),
  tool('stone_api_search', '检索官方接口', '检索全部官方桌面 API、控制器 ST 系统库和帮助页。先检索再用 stone_api_get 读取签名、参数方向、示例和原文。控制器库只在 ST 程序内执行。', {
    query: textSchema('名称、签名或官方说明关键词；空字符串列出全部。', { minLength: 0, maxLength: 200 }),
    surface: { type: 'string', enum: ['desktop', 'controller', 'help'] }, namespace: textSchema('命名空间，支持前缀。'),
    kind: textSchema('function/method/class/struct/enum/interface/union/function_block/named_value/page。'),
    offset: integerSchema('分页偏移。', 0, 100000), limit: integerSchema('每页条数，默认 20。', 1, 50),
  }, [], 'search', true),
  tool('stone_api_get', '读取官方接口详情', '按检索结果的完整 sourceId 读取参数、返回值和示例；分页输出可完整取回长条目，不会静默截断。', {
    sourceId: textSchema('检索结果的完整 sourceId。'), offset: integerSchema('详情文本偏移。', 0, 10000000), limit: integerSchema('详情字符数，默认 24000。', 1000, 64000),
  }, ['sourceId'], 'reference', true),
  ...methodTools,
  ...[
    ['solution', 'Solution', {}, []], ['project', 'Project', projectSelector, ['projectName']],
    ['project_configuration', 'ProjectConfiguration', configurationSelector, ['projectName', 'configurationName']],
    ['target', 'Target', {}, []], ['task', 'Task', { taskName: textSchema('目标任务名称。') }, ['taskName']],
  ].map(([name, receiver, properties, required]) => tool(`stone_${name}_inspect`, '读取官方对象属性', `读取 ${receiver} 的全部官方属性；不包含未公开的反射成员。`, { ...properties, timeoutMs: timeoutSchema }, required, 'inspect', true, { receiver })),
  tool('stone_project_update_properties', '修改项目属性', '修改官方可写的 Author、Vendor、GenerateMetadataFile；随后调用 stone_solution_save 持久化。', { ...projectSelector, properties: { ...propertySchema(propertyFields.Project), minProperties: 1 }, timeoutMs: timeoutSchema }, ['projectName', 'properties'], 'properties', false, { receiver: 'Project' }),
  tool('stone_project_configuration_update', '修改编译配置', '修改 ProjectConfiguration 官方属性，包含编译选项、宏定义和构建命令；需要用户审批，随后保存解决方案。', { ...configurationSelector, properties: { ...propertySchema(propertyFields.ProjectConfiguration), minProperties: 1 }, timeoutMs: timeoutSchema }, ['projectName', 'configurationName', 'properties'], 'properties', false, { receiver: 'ProjectConfiguration' }),
  tool('stone_session_status', '查看自动化会话', '查看当前 MCP 的 SToneCLI 会话与未保存状态。会话退出后不保留 Watch 句柄。', {}, [], 'status', true),
  tool('stone_session_close', '结束自动化会话', '关闭本次会话的 CLI 和连接。请先保存；不自动保存、不自动重放写操作。', {}, [], 'close'),
  tool('stone_cli_build', '命令行编译', '调用官方 build；返回真实退出码和输出，不使用静态诊断替代编译。运行前请保存并关闭 IronPython 解决方案。', {
    ...configuredProjectArgs, metadata: { type: 'string', enum: ['project', 'enable', 'disable'] }, timeoutMs: timeoutSchema,
  }, ['solutionPath', 'projectName', 'configurationName'], 'cli', false, { command: 'build' }),
  tool('stone_cli_automatic_test', '运行自动测试', '调用官方 automatic-test；会连接目标运行测试，执行前请确认目标与授权。', { ...configuredProjectArgs, connectionString: textSchema('目标连接字符串。'), timeoutMs: timeoutSchema }, ['solutionPath', 'projectName', 'configurationName', 'connectionString'], 'cli', false, { command: 'automatic-test' }),
  tool('stone_cli_unit_tests', '运行单元测试和覆盖率', '调用官方 unit-tests，支持 JUnit/Cobertura 输出和覆盖率门槛。-c 在此命令中是覆盖率报告路径，不是配置名称。此操作会编译、下载和运行测试。', {
    ...projectArgs, connectionString: textSchema('可选目标连接字符串。'), reportPath: textSchema('JUnit 报告绝对路径。'),
    codeCoverage: booleanSchema('启用代码覆盖率。'), coveragePath: textSchema('Cobertura 报告绝对路径，要求 codeCoverage=true。'),
    minimumCoverage: { type: 'number', minimum: 0, maximum: 100, description: '覆盖率下限，要求 codeCoverage=true。' },
    logLevel: { type: 'string', enum: ['Verbose', 'Normal', 'Quiet'] }, timeoutMs: timeoutSchema,
  }, ['solutionPath', 'projectName'], 'cli', false, { command: 'unit-tests' }),
  tool('stone_cli_export_workspace', '导出工作区', '调用官方 export-workspace，导出 Spark 配置、语言、Profile 和文档。参数采用官方示例的 --s/--o 形式。', {
    sparkPath: textSchema('现有 .spark 文件绝对路径。'), outputDirectory: textSchema('输出目录绝对路径。'), all: booleanSchema('导出全部。'),
    configurations: stringList('配置名称。'), allConfigurations: booleanSchema('导出全部配置。'), languages: stringList('语言名称。'),
    allLanguages: booleanSchema('导出全部语言。'), profiles: stringList('Profile 名称。'), allProfiles: booleanSchema('导出全部 Profile。'),
    documents: stringList('需要导出的文档文件绝对路径。'), timeoutMs: timeoutSchema,
  }, ['sparkPath', 'outputDirectory'], 'cli', false, { command: 'export-workspace' }),
  tool('stone_cli_hardware_id', '读取许可硬件 ID', '调用官方 activate-license --show-hardware-id；不会激活或更改许可证。', { timeoutMs: timeoutSchema }, [], 'cli', true, { command: 'hardware-id' }),
  tool('stone_cli_iron_python', '执行官方 IronPython 脚本', '通过 SToneCLI iron-python 执行用户提供的 Python 脚本，支持官方 -a 参数。脚本拥有本机与设备访问能力，必须经客户端审批；不向脚本注入虚假的 stone 实现。执行前关闭当前工程会话。', {
    scriptPath: textSchema('现有 .py 脚本的绝对路径。'), scriptArgs: { type: 'array', items: { type: 'string', maxLength: 32768 }, maxItems: 100, description: '传递给官方 sys.argv 的字符串参数。' }, timeoutMs: timeoutSchema,
  }, ['scriptPath'], 'cli', false, { command: 'iron-python' }),
  tool('stone_cli_activate_license', '在线激活许可证', '调用官方在线激活命令；使用用户提供的许可信息，不自动购买许可。序列号不写入返回日志。', { serialNumber: textSchema('许可序列号。'), company: textSchema('公司。'), address: textSchema('地址。'), country: textSchema('国家。'), timeoutMs: timeoutSchema }, ['serialNumber', 'company', 'address', 'country'], 'cli', false, { command: 'activate-license' }),
  tool('stone_cli_activate_license_offline', '离线激活许可证', '调用官方 activate-license --filename，以用户提供的 .jlic 文件激活。', { licensePath: textSchema('现有 .jlic 文件绝对路径。'), timeoutMs: timeoutSchema }, ['licensePath'], 'cli', false, { command: 'activate-license-offline' }),
]

/** 检索索引一次构建；工具列表不塞入 1138 个文档工具，避免占满模型上下文。 */
const searchIndex = references.map(item => ({ item, text: `${item.namespace ?? ''} ${item.name ?? ''} ${item.signature ?? ''} ${item.description ?? ''} ${item.officialContent ?? ''}`.toLowerCase() }))
export function searchReferences({ query = '', surface, namespace, kind, offset = 0, limit = 20 } = {}) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = searchIndex.filter(({ item, text }) => (!surface || item.surface === surface)
    && (!namespace || item.namespace?.toLowerCase().startsWith(namespace.toLowerCase())) && (!kind || item.kind === kind)
    && terms.every(term => text.includes(term)))
  return { total: matches.length, offset, nextOffset: offset + limit < matches.length ? offset + limit : null,
    items: matches.slice(offset, offset + limit).map(({ item }) => ({ sourceId: item.sourceId, surface: item.surface, namespace: item.namespace,
      kind: item.kind, name: item.name, signature: item.officialSignature || item.signature, description: (item.description || item.officialContent || '').slice(0, 350),
      uri: `stone://api/${encodeURIComponent(item.sourceId)}`, executable: item.surface === 'desktop' })) }
}

export function getReference({ sourceId, offset = 0, limit = 24000 }) {
  const item = referenceById.get(sourceId)
  if (!item) throw new Error('没有找到该 sourceId，请先使用 stone_api_search 检索。')
  const text = JSON.stringify(item, null, 2)
  return { sourceId, totalCharacters: text.length, offset, nextOffset: offset + limit < text.length ? offset + limit : null, text: text.slice(offset, offset + limit) }
}

export const bridgeManifest = {
  methods: methodTools.map(({ method, member }) => ({ receiver: method.receiver, member })),
  fields: Object.fromEntries(desktopPages.filter(page => page.fields.length).map(page => [page.title.replace(' ', ''), page.fields.map(field => field.name)])),
  writable: Object.fromEntries(Object.entries(propertyFields).map(([name, fields]) => [name, fields.map(field => field.name)])),
}
