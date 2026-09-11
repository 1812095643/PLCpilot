import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDiagnosticLogger, registerDiagnosticSecrets, diagnosticTextSink } from './diagnostics.mjs'
import { runProcess } from '../stone-mcp/runtime.mjs'

test('日志真实落盘、中文诊断可读、参数与跨管道分块的凭据被隐藏', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plc-log-test-'))
  const logger = createDiagnosticLogger('test', { root })
  try {
    registerDiagnosticSecrets({ api_key: 'private-key-for-log-test', args: ['--password', 'split-password-value'] })
    logger.info('tool.start', { requestId: 7, api_key: 'private-key-for-log-test', arguments: ['--password', 'split-password-value'] })
    const sink = diagnosticTextSink(logger, 'cli.stderr')
    sink.write('中文诊断 split-pass'); sink.write('word-value\n'); sink.end()
    logger.error('tool.error', { error: new Error('private-key-for-log-test Authorization: Bearer tokenvalue') })
    logger.info('tool.image', { type: 'image', data: 'private-image-bytes' })
    logger.close()
    const text = await readFile(logger.path, 'utf8')
    assert.ok(text.includes('中文诊断') && text.includes('tool.error'))
    for (const secret of ['private-key-for-log-test', 'split-password-value', 'tokenvalue', 'private-image-bytes']) assert.ok(!text.includes(secret), secret)
    const entries = text.trim().split('\n').map(line => JSON.parse(line))
    assert.ok(entries.every(entry => entry.time && entry.pid && entry.runId && entry.version))
    assert.equal(entries[0].data.requestId, 7)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('日志超过大小限制自动轮转并清理旧文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plc-log-rotation-'))
  const logger = createDiagnosticLogger('rotation', { root, maxBytes: 1024, maxFiles: 3 })
  try {
    for (let index = 0; index < 25; index++) logger.info('line', { index, text: '诊断'.repeat(100) })
    logger.close()
    const files = await readdir(join(root, 'rotation'))
    assert.equal(files.length, 3)
    assert.ok((await readFile(logger.path, 'utf8')).includes('"index":24'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('真实子进程的 stdout、stderr、退出码和取消原因均留在文件中', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plc-process-log-'))
  const logger = createDiagnosticLogger('process', { root })
  try {
    await runProcess(process.execPath, ['-e', 'console.log("真实输出"); console.error("编译诊断"); process.exitCode=7'], { logger })
    const controller = new AbortController()
    const waiting = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { logger, signal: controller.signal, onChild: () => setTimeout(() => controller.abort(), 100) })
    await assert.rejects(waiting, /取消/)
    logger.close()
    const text = await readFile(logger.path, 'utf8')
    for (const event of ['cli.start', 'cli.stdout', 'cli.stderr', 'cli.exit', 'cli.interrupt', '真实输出', '编译诊断']) assert.ok(text.includes(event), event)
    assert.ok(text.includes('"code":7'))
  } finally { await rm(root, { recursive: true, force: true }) }
})
