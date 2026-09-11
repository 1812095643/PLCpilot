import { createDiagnosticLogger, observeProcess } from '../shared/diagnostics.mjs'

// 在载入资料和 MCP 实现之前建立文件日志；缺少资源/JSON 损坏也能留下启动证据。
const logger = createDiagnosticLogger('stone-mcp')
observeProcess(logger)
try {
  const { main } = await import('./server.mjs')
  await main(logger)
} catch (error) {
  logger.error('mcp.start.error', { error })
  process.stderr.write('STone MCP 启动未完成，请查看 PLC Pilot 日志文件夹。\n')
  process.exitCode = 1
}
