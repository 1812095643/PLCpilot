import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm, cp, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { tools, methods, officialApi, referenceById, searchReferences, getReference, bridgeManifest } from '../catalog.mjs'
import { bridgeRequest, officialFailure } from '../server.mjs'
import { cliArguments, exitMeaning, redact } from '../cli.mjs'
import { findStoneCli, runProcess } from '../runtime.mjs'

const root = resolve(import.meta.dirname, '..', '..')

test('官方资料保持原始 SHA256，33 个方法逐一映射且无重载丢失', async () => {
  const original = await readFile(join(root, 'stone-mcp/data/official-api.json'))
  assert.equal(createHash('sha256').update(original).digest('hex'), '67266d84084a63aa490859e2fd5ffe3da485d3648fa0bf7ba376922f342a0c50')
  assert.equal(methods.length, 33)
  assert.equal(tools.length, 53)
  assert.equal(new Set(tools.map(tool => tool.name)).size, 53)
  for (const method of officialApi.desktopAutomation.allMethods) {
    const matches = tools.filter(tool => tool.sourceId === method.sourceId)
    assert.equal(matches.length, 1, method.signature)
    for (const parameter of method.parameters) assert.ok(matches[0].inputSchema.properties[parameter.name], parameter.name)
  }
})

test('完整覆盖 1138 个 ST 条目和 126 个原文页面；长原文可无损分段取回', () => {
  assert.equal(officialApi.controllerStructuredTextApi.allItems.length, 1138)
  for (const entry of officialApi.controllerStructuredTextApi.allItems) assert.equal(referenceById.get(entry.sourceId).officialSynopsis, entry.officialSynopsis)
  assert.equal(referenceById.size, 33 + 1138 + 72 + 54)
  const page = officialApi.sourcePages.api.reduce((best, item) => item.officialContent.length > best.officialContent.length ? item : best)
  let offset = 0, text = ''
  do { const result = getReference({ sourceId: page.sourceId, offset, limit: 1000 }); text += result.text; offset = result.nextOffset } while (offset !== null)
  assert.equal(JSON.parse(text).officialContent, page.officialContent)
  const results = searchReferences({ query: 'Read', surface: 'controller', limit: 50 })
  assert.ok(results.total > 0)
  assert.ok(results.items.every(item => item.executable === false))
})

test('JSON Schema 拒绝多余属性、布尔字符串与只读属性修改', () => {
  const validator = new AjvJsonSchemaValidator()
  const validate = (name, input) => validator.getValidator(tools.find(tool => tool.name === name).inputSchema)(input).valid
  assert.equal(validate('stone_solution_remove_project', { projectName: '中文工程', delete: 'false' }), false)
  assert.equal(validate('stone_solution_remove_project', { projectName: '中文工程', delete: false }), true)
  assert.equal(validate('stone_solution_build', { script: '__import__("os")' }), false)
  assert.equal(validate('stone_project_update_properties', { projectName: 'A', properties: { Path: 'C:\\other' } }), false)
  assert.equal(validate('stone_project_configuration_update', { projectName: 'A', configurationName: 'Debug', properties: { Coverage: true } }), true)
  assert.equal(validate('stone_api_search', { limit: 1000 }), false)
  assert.equal(bridgeManifest.writable.ProjectConfiguration.length, 18)
})

test('缺省值按官方签名补齐，CreateWatch 参数名差异使用位置参数', () => {
  const definition = name => tools.find(tool => tool.name === name)
  assert.deepEqual(bridgeRequest(definition('stone_project_get_libs_names'), { projectName: '中文工程' }).args, [true, true, true])
  assert.deepEqual(bridgeRequest(definition('stone_solution_remove_project'), { projectName: 'A' }).args, ['A', false])
  const variable = 'Main."特殊字符串"\n中文'
  assert.deepEqual(bridgeRequest(definition('stone_target_create_watch'), { variable }).args, [variable])
  assert.deepEqual(bridgeRequest(definition('stone_watch_write_value'), { watchId: 'known', value: '0' }).args, ['0'])
})

test('官方 Result 与布尔返回决定工具结果，退出 0 不能掩盖编译诊断', () => {
  assert.equal(officialFailure({ result: { IsSuccessful: false, Errors: [{ Description: '真实诊断' }] } }), true)
  assert.equal(officialFailure({ succeeded: false }), true)
  assert.equal(officialFailure({ result: { IsSuccessful: true, Warnings: [] } }), false)
  assert.equal(exitMeaning('unit-tests', -12), '覆盖率未达到最低要求')
  assert.equal(exitMeaning('iron-python', -3), 'Python 脚本抛出异常')
})

test('CLI 按各命令真实语义组装参数；中文与特殊字符保持单一 argv', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stone-arguments-'))
  try {
    // 这里只验证文件参数和 argv，文件内容不是有效 STone 工程，也不会交给厂商执行。
    const path = join(directory, '中文 & 参数.stone')
    await writeFile(path, '仅用于参数解析验证')
    const report = join(directory, '覆盖率.xml')
    const args = cliArguments('unit-tests', { solutionPath: path, projectName: '项目 & 名称', codeCoverage: true, coveragePath: report, minimumCoverage: 0 })
    assert.deepEqual(args, ['unit-tests', '-s', path, '-p', '项目 & 名称', '--code-coverage', '-c', report, '-m', '0'])
    assert.throws(() => cliArguments('unit-tests', { solutionPath: path, projectName: 'A', minimumCoverage: 90 }), /codeCoverage/)
    const buildArgs = cliArguments('build', { solutionPath: path, projectName: 'A', configurationName: 'Debug', metadata: 'enable' })
    assert.ok(buildArgs.includes('--enable-metadata-file'))
    assert.equal(buildArgs[buildArgs.indexOf('-c') + 1], 'Debug')
    assert.throws(() => cliArguments('shell', {}), /官方接口清单/)
    const scriptArgs = cliArguments('iron-python', { scriptPath: join(root, 'stone-mcp/bridge.py'), scriptArgs: ['中文 参数', ''] })
    assert.deepEqual(scriptArgs.slice(-3), ['-a', '中文 参数', ''])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('运行环境与凭据：显式错误路径不静默回退，许可参数不泄露', () => {
  assert.equal(findStoneCli({ STONE_CLI_PATH: process.execPath }), null)
  assert.equal(findStoneCli({ STONE_CLI_PATH: 'relative/SToneCLI.exe' }), null)
  assert.equal(redact('许可证 secret 公司 company 地址 address', { serialNumber: 'secret', company: 'company', address: 'address' }), '许可证 [已隐藏] 公司 [已隐藏] 地址 [已隐藏]')
})

test('真实子进程的 argv/标准输出/非零退出码可传回，取消会终止进程', async () => {
  const argument = '中文 & "引号" $(不会执行)'
  const output = await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1]); process.stderr.write("诊断"); process.exitCode=7', argument])
  assert.equal(output.stdout, argument)
  assert.equal(output.stderr, '诊断')
  assert.equal(output.exitCode, 7)
  const controller = new AbortController()
  let child
  const waiting = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal, onChild: value => { child = value; setTimeout(() => controller.abort(), 100) } })
  await assert.rejects(waiting, /取消/)
  assert.ok(child.exitCode !== null || child.signalCode !== null)
})

async function protocolCheck(script, cwd) {
  const logRoot = await mkdtemp(join(tmpdir(), 'stone-protocol-logs-'))
  const transport = new StdioClientTransport({ command: process.execPath, args: [script], cwd,
    env: { ...process.env, PLC_PILOT_LOG_DIR: logRoot, STONE_CLI_PATH: join(cwd, '未安装', 'SToneCLI.exe') }, stderr: 'pipe' })
  let diagnostics = ''
  transport.stderr.on('data', chunk => { diagnostics += chunk })
  const client = new Client({ name: 'plc-pilot-stone-verification', version: '1.0.0' })
  try {
    await client.connect(transport)
    const listed = await client.listTools()
    assert.equal(listed.tools.length, 53)
    assert.equal(listed.tools.find(tool => tool.name === 'stone_target_clear_binaries').annotations.readOnlyHint, false)
    const call = (name, args = {}) => client.callTool({ name, arguments: args })
    const environment = await call('stone_environment')
    assert.equal(environment.structuredContent.automationAvailable, false)
    assert.equal(environment.structuredContent.coverage.controllerItems, 1138)
    const search = await call('stone_api_search', { query: 'GetEmbeddedEnumDescription', surface: 'controller', kind: 'function' })
    assert.ok(search.structuredContent.total > 0)
    const item = search.structuredContent.items[0]
    const detail = await call('stone_api_get', { sourceId: item.sourceId })
    assert.ok(JSON.parse(detail.structuredContent.text).parameters.some(parameter => parameter.direction === 'InOut'))
    const resource = await client.readResource({ uri: item.uri })
    assert.equal(JSON.parse(resource.contents[0].text).sourceId, item.sourceId)
    let cursor, count = 0
    do { const page = await client.listResources(cursor ? { cursor } : {}); count += page.resources.length; cursor = page.nextCursor } while (cursor)
    assert.equal(count, 1297)
    assert.equal((await client.listPrompts()).prompts.length, 1)
    assert.match((await client.getPrompt({ name: 'stone_engineering_workflow' })).messages[0].content.text, /IsSuccessful/)
    assert.equal((await call('stone_solution_build')).isError, true)
    assert.equal((await call('stone_solution_build', { arbitrary: true, api_key: 'private-protocol-log-secret' })).isError, true)
    assert.equal((await call('stone_api_get', { sourceId: '不存在' })).isError, true)
    assert.equal((await call('stone_session_status')).structuredContent.running, false)
    assert.equal((await call('stone_session_close')).isError, false)
    assert.equal(diagnostics, '')
    const filenames = await readdir(join(logRoot, 'stone-mcp'))
    const content = (await Promise.all(filenames.map(name => readFile(join(logRoot, 'stone-mcp', name), 'utf8')))).join('\n')
    for (const event of ['mcp.initialized', 'mcp.tools.list', 'tool.start', 'tool.finish', 'tool.error', 'tool.validation']) assert.ok(content.includes(event), event)
    assert.ok(content.includes('没有找到 SToneCLI'))
    assert.ok(!content.includes('private-protocol-log-secret'))
  } finally { await client.close(); await transport.close(); await rm(logRoot, { recursive: true, force: true }) }
}

test('真实 MCP stdio 联调：初始化、53 个工具、全部资源分页、调用和缺少 STone 的错误路径', async () => {
  await protocolCheck(join(root, 'stone-mcp/entry.mjs'), root)
})

test('独立包缺少资料时，初始化前的故障也会写入日志', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stone-startup-logs-'))
  try {
    await cp(join(root, 'stone-mcp/dist'), directory, { recursive: true })
    await rm(join(directory, 'data/official-api.json.gz'))
    await assert.rejects(promisify(execFile)(process.execPath, [join(directory, 'stone-mcp-server.mjs')], { windowsHide: true, timeout: 10000,
      env: { ...process.env, PLC_PILOT_LOG_DIR: join(directory, 'logs') } }))
    const files = await readdir(join(directory, 'logs/stone-mcp'))
    const text = (await Promise.all(files.map(name => readFile(join(directory, 'logs/stone-mcp', name), 'utf8')))).join('\n')
    assert.ok(text.includes('mcp.start.error') && text.includes('official-api.json'))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('发布 bundle 在仓库之外运行，不依赖 node_modules、D 盘资料或构建机路径', async () => {
  const source = join(root, 'stone-mcp/dist')
  assert.ok(existsSync(join(source, 'stone-mcp-server.mjs')), '请先运行 npm run build:stone-mcp')
  const directory = await mkdtemp(join(tmpdir(), 'stone-standalone-'))
  try {
    await cp(source, directory, { recursive: true })
    await protocolCheck(join(directory, 'stone-mcp-server.mjs'), directory)
    const policy = JSON.parse(await readFile(join(root, 'stone-mcp/tool-policy.json'), 'utf8'))
    for (const tool of tools) assert.equal(policy[tool.name], !tool.annotations.readOnlyHint, tool.name)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
