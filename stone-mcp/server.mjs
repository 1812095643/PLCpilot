import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { tools, officialApi, methods, references, referenceById, getReference, searchReferences } from './catalog.mjs'
import { StoneRuntime, findStoneCli } from './runtime.mjs'
import { runCliTool, validateMethodPaths, redact } from './cli.mjs'
import { createDiagnosticLogger, registerDiagnosticSecrets, registerDiagnosticSecretValues, observeProcess } from '../shared/diagnostics.mjs'

export const serverInstructions = '这是 PLC Pilot 的 CAREL STone MCP。先调用 stone_environment。使用 stone_api_search / stone_api_get 获取官方依据；controller 条目是在控制器内执行的 ST 库，不是电脑端远程接口。工程调用在当前 MCP 会话复用 SToneCLI/IronPython；打开解决方案后再操作项目，修改后保存，编译检查 Result.IsSuccessful 与诊断。下载前必须在本会话编译通过并先断开连接。修改工程、构建命令、变量写入、下载、重启、清除应用和许可激活应遵循客户端用户审批。进程退出或超时后重新打开工程，旧 Watch 句柄不可复用，不自动重放写操作。知识库可以离线使用，真实自动化需要用户安装并许可 STone。'
const validator = new AjvJsonSchemaValidator()
const toolMap = new Map(tools.map(tool => [tool.name, { ...tool, validate: validator.getValidator(tool.inputSchema) }]))
export const publicTools = tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }))

export function officialFailure(value) {
  if (!value || typeof value !== 'object') return false
  if (value.succeeded === false || value.IsSuccessful === false) return true
  return Object.values(value).some(item => Array.isArray(item) ? item.some(officialFailure) : officialFailure(item))
}

/** 从 schema 填充可选值，位置顺序严格取官方参数表，不拼接 Python 源码。 */
export function bridgeRequest(definition, input) {
  const request = { action: definition.handler === 'method' ? 'call' : definition.handler, receiver: definition.method?.receiver ?? definition.receiver }
  for (const key of ['projectName', 'watchId', 'taskName', 'configurationName', 'properties']) if (input[key] !== undefined) request[key] = input[key]
  if (definition.handler === 'method') {
    validateMethodPaths(definition, input)
    request.member = definition.member
    request.args = definition.method.parameters.map(parameter => input[parameter.name] ?? definition.inputSchema.properties[parameter.name].default)
  }
  return request
}

export function createStoneServer(logger = createDiagnosticLogger('stone-mcp')) {
  const runtime = new StoneRuntime(logger)
  const server = new Server({ name: 'plc-pilot-stone', version: '0.1.1' }, { capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} }, instructions: serverInstructions })
  server.oninitialized = () => logger.info('mcp.initialized', { tools: publicTools.length })
  server.setRequestHandler(ListToolsRequestSchema, async () => { logger.info('mcp.tools.list', { count: publicTools.length }); return { tools: publicTools } })
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const started = Date.now()
    const requestId = extra.requestId
    registerDiagnosticSecrets(request.params.arguments)
    if (request.params.name === 'stone_cli_activate_license') registerDiagnosticSecretValues([request.params.arguments?.serialNumber, request.params.arguments?.company, request.params.arguments?.address])
    logger.info('tool.start', { requestId, name: request.params.name, arguments: request.params.arguments })
    const definition = toolMap.get(request.params.name)
    if (!definition) { logger.error('tool.unknown', { requestId, name: request.params.name }); throw new McpError(ErrorCode.InvalidParams, '没有这个 STone 工具，请重新获取工具列表。') }
    const input = request.params.arguments ?? {}
    const checked = definition.validate(input)
    if (!checked.valid) { logger.error('tool.validation', { requestId, error: checked.errorMessage }); return { content: [{ type: 'text', text: `请按工具参数说明调整输入：${checked.errorMessage}` }], isError: true } }
    let progress = 0, lastLog = 0
    const token = request.params._meta?.progressToken
    const notify = message => {
      if (token !== undefined) void server.notification({ method: 'notifications/progress', params: { progressToken: token, progress: progress++, message } }).catch(() => {})
    }
    const executable = ['method', 'inspect', 'properties', 'cli'].includes(definition.handler)
    if (executable) notify(`正在执行：${definition.title}`)
    const timer = executable ? setInterval(() => notify(`STone 正在执行：${definition.title}`), 10000) : null
    try {
      extra.signal.throwIfAborted()
      let data
      switch (definition.handler) {
        case 'environment': data = {
          cliPath: findStoneCli(), platform: process.platform, automationAvailable: process.platform === 'win32' && Boolean(findStoneCli()),
          licenseVerified: false, vendorExecutionVerified: false,
          message: findStoneCli() ? '已找到 CLI；实际许可与工程能力以执行结果为准。' : '尚未找到 SToneCLI，请安装 STone 并设置 STONE_CLI_PATH；全部官方 API 参考已可用。',
          coverage: { ironPythonMethods: methods.length, cliTools: tools.filter(tool => tool.handler === 'cli').length,
            controllerItems: officialApi.controllerStructuredTextApi.itemCount, namespaces: officialApi.controllerStructuredTextApi.namespaceCount,
            helpPages: officialApi.sourcePages.help.length, apiPages: officialApi.sourcePages.api.length },
          sourceGeneratedAt: officialApi.generatedAt,
        }; break
        case 'search': data = searchReferences(input); break
        case 'reference': data = getReference(input); break
        case 'status': data = runtime.status(); break
        case 'close':
          data = await runtime.serial(async () => {
            if (runtime.state.dirty) throw new Error('工程存在未保存修改，请先调用 stone_solution_save，再结束会话。')
            await runtime.stop(); return { closed: true }
          }, extra.signal)
          break
        case 'method': case 'inspect': case 'properties':
          data = await runtime.call(bridgeRequest(definition, input), { signal: extra.signal, timeoutMs: input.timeoutMs })
          break
        case 'cli': data = await runCliTool(runtime, definition, input, {
          signal: extra.signal,
          onOutput: text => {
            notify(text.trim().slice(-500) || definition.title)
            if (Date.now() - lastLog > 1000) { lastLog = Date.now(); void server.sendLoggingMessage({ level: 'info', logger: 'SToneCLI', data: text.slice(-2000) }).catch(() => {}) }
          },
        }); break
        default: throw new Error('该工具尚未匹配到执行入口。')
      }
      const isError = executable && officialFailure(data)
      logger[isError ? 'error' : 'info']('tool.finish', { requestId, name: definition.name, durationMs: Date.now() - started, isError,
        result: ['search', 'reference'].includes(definition.handler) ? { sourceId: data.sourceId, total: data.total } : data })
      if (executable) notify(isError ? 'STone 返回未完成，请检查官方诊断。' : `已返回：${definition.title}`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data, isError }
    } catch (error) {
      logger.error('tool.error', { requestId, name: definition.name, durationMs: Date.now() - started, error, aborted: extra.signal.aborted, session: runtime.status() })
      return { content: [{ type: 'text', text: redact(error.message ?? String(error), input) }], isError: true }
    } finally { if (timer) clearInterval(timer) }
  })

  server.setRequestHandler(ListResourcesRequestSchema, async request => {
    const cursor = request.params?.cursor ?? '0'
    if (!/^\d+$/.test(cursor)) throw new McpError(ErrorCode.InvalidParams, '资源分页游标不正确。')
    const offset = Number(cursor)
    const resources = references.slice(offset, offset + 100).map(item => ({ uri: `stone://api/${encodeURIComponent(item.sourceId)}`, name: item.signature || item.name, description: `${item.surface} · ${item.namespace || item.kind}`, mimeType: 'application/json' }))
    return { resources, ...(offset + 100 < references.length ? { nextCursor: String(offset + 100) } : {}) }
  })
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [{ uriTemplate: 'stone://api/{sourceId}', name: 'STone 官方接口详情', description: 'sourceId 使用完整编码后的官方检索标识。', mimeType: 'application/json' }] }))
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    const prefix = 'stone://api/'
    let item
    try { if (request.params.uri.startsWith(prefix)) item = referenceById.get(decodeURIComponent(request.params.uri.slice(prefix.length))) } catch { /* 统一返回不存在，绝不把资源 URI 当文件路径读取。 */ }
    if (!item) throw new McpError(ErrorCode.InvalidParams, '没有找到该官方 API 资源，请先检索。')
    return { contents: [{ uri: request.params.uri, mimeType: 'application/json', text: JSON.stringify(item, null, 2) }] }
  })
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: 'stone_engineering_workflow', title: 'STone 工程工作流', description: '从官方接口检索到工程编译与测试的真实调用顺序。' }] }))
  server.setRequestHandler(GetPromptRequestSchema, async request => {
    if (request.params.name !== 'stone_engineering_workflow') throw new McpError(ErrorCode.InvalidParams, '没有这个工作流。')
    return { messages: [{ role: 'user', content: { type: 'text', text: `${serverInstructions}\n执行顺序：环境检查 → 检索官方接口 → 打开/创建解决方案 → inspect 项目与配置 → 修改/添加 ST 文件和库 → 保存 → Build 并检查官方诊断。只有用户要求运行目标时才启动模拟器/连接/下载。CLI 测试前保存并关闭 IronPython 解决方案。没有 STone 或许可时报告缺项，不伪造编译和设备结果。` } }] }
  })
  return { server, runtime, logger }
}

export async function main(existingLogger) {
  const { server, runtime, logger } = createStoneServer(existingLogger)
  if (!existingLogger) observeProcess(logger)
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    logger.info('mcp.close', { session: runtime.status() })
    await runtime.stop()
    await server.close()
  }
  server.onclose = () => { void close() }
  server.onerror = error => { logger.error('mcp.protocol.error', { error }); process.stderr.write(`STone MCP：${error.message}\n`) }
  process.once('SIGINT', () => { void close() })
  process.once('SIGTERM', () => { void close() })
  process.stdin.once('end', () => { void close() })
  await server.connect(new StdioServerTransport())
}

// 启动统一交给 entry.mjs。打包后所有模块共享 import.meta.url，不能在此再用
// argv 判断直接执行，否则会同时启动两个 stdio Server，产生重复握手响应。
