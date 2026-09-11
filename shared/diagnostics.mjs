import pino from 'pino'
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import metadata from '../package.json' with { type: 'json' }

const secrets = new Set()
const sensitiveKey = key => /^(key|apikey|password|passwd|secret|token|accesstoken|refreshtoken|authorization|cookie|setcookie|serialnumber|privatekey|clientsecret)$/.test(key.replace(/[-_\s]/g, '').toLowerCase())
  || /(?:API[-_]KEY|PASSWORD|SECRET|TOKEN|PRIVATE[-_]KEY)$/i.test(key)

/** 凭据只保留在内存中用于过滤，绝不作为日志字段输出。 */
export function registerDiagnosticSecrets(value) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (typeof value[index - 1] === 'string' && sensitiveKey(value[index - 1].replace(/^--?/, ''))) registerDiagnosticSecretValues([item])
      else if (item && typeof item === 'object') registerDiagnosticSecrets(item)
    })
    return
  }
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKey(key) && typeof item === 'string' && item.length >= 4) secrets.add(item)
    else if (item && typeof item === 'object') registerDiagnosticSecrets(item)
  }
}

export function registerDiagnosticSecretValues(values) {
  for (const value of values) if (typeof value === 'string' && value.length >= 4) secrets.add(value)
}

export function sanitizeDiagnostic(value, depth = 0) {
  if (depth > 10) return '[嵌套层级已截断]'
  if (value instanceof Error) return { name: value.name, message: sanitizeDiagnostic(value.message), stack: sanitizeDiagnostic(value.stack ?? '') }
  if (typeof value === 'string') {
    let text = value
    for (const secret of secrets) text = text.split(secret).join('[已隐藏]')
    text = text.replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=\s]+/g, '[图片或附件数据已隐藏]')
      .replace(/\b(https?:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[已隐藏]@')
      .replace(/((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[已隐藏]')
      .replace(/([?&](?:api[_-]?key|token|access_token|secret|password)=)[^&#\s]+/gi, '$1[已隐藏]')
      .replace(/((?:api[_-]?key|password|passwd|secret|token|authorization|serial[_-]?number)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, '$1[已隐藏]')
    if (text.length > 16384) return `${text.slice(0, 8192)}\n[日志字段共 ${text.length} 字符，中间已截断]\n${text.slice(-8192)}`
    return text
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item, index) => typeof value[index - 1] === 'string' && sensitiveKey(value[index - 1].replace(/^--?/, '')) ? '[已隐藏]' : sanitizeDiagnostic(item, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key,
    key === 'data_base64' || key === 'blob' || (key === 'data' && ['image', 'audio'].includes(value.type ?? value.kind))
      ? '[附件数据已隐藏]' : sensitiveKey(key) ? '[已隐藏]' : sanitizeDiagnostic(item, depth + 1)]))
  return value ?? null
}

export function defaultLogRoot() {
  if (process.env.PLC_PILOT_LOG_DIR && isAbsolute(process.env.PLC_PILOT_LOG_DIR)) return process.env.PLC_PILOT_LOG_DIR
  const local = process.env.LOCALAPPDATA && isAbsolute(process.env.LOCALAPPDATA) ? process.env.LOCALAPPDATA : join(homedir(), 'AppData', 'Local')
  return join(local, 'PLC Pilot', 'logs')
}

/** 复用 Pino 的同步文件输出；逐次落盘，进程异常退出也保留已经写出的记录。 */
export function createDiagnosticLogger(component, options = {}) {
  if (!/^[a-z0-9-]+$/.test(component)) throw new Error('日志组件名称只能包含小写字母、数字和连字符。')
  const runId = process.env.PLC_PILOT_RUN_ID || randomUUID()
  const logId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${randomUUID().slice(0, 8)}`
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024
  const maxFiles = options.maxFiles ?? 20
  let directory, actualRoot, filename, destination, logger, bytes = 0, sequence = 0, failed = false
  const open = root => {
    actualRoot = root
    directory = join(root, component)
    mkdirSync(directory, { recursive: true })
    filename = join(directory, `${component}-${logId}-${sequence++}.jsonl`)
    destination = pino.destination({ dest: filename, sync: true, mkdir: true })
    destination.on('error', () => { failed = true })
    logger = pino({ timestamp: pino.stdTimeFunctions.isoTime, base: { component, pid: process.pid, runId, version: metadata.version } }, destination)
    const old = readdirSync(directory).filter(name => name.startsWith(`${component}-`) && name.endsWith('.jsonl'))
      .flatMap(name => { try { return [{ path: join(directory, name), time: statSync(join(directory, name)).mtimeMs }] } catch { return [] } }).sort((a, b) => b.time - a.time)
    for (const file of old.filter(file => file.path !== filename).slice(Math.max(0, maxFiles - 1))) { try { unlinkSync(file.path) } catch { /* 正在使用的文件留待下次清理。 */ } }
    bytes = 0
  }
  try { open(options.root ?? defaultLogRoot()) }
  catch {
    try { open(join(tmpdir(), 'PLC Pilot', 'logs')) }
    catch { failed = true; process.stderr.write('PLC Pilot 日志目录不可写，请检查本机磁盘权限和剩余空间。\n') }
  }
  const write = (level, event, data = {}) => {
    if (failed || !logger) return
    try {
      let safe = sanitizeDiagnostic(data)
      const serialized = JSON.stringify(safe)
      if (serialized.length > 64000) safe = { summary: `${serialized.slice(0, 16000)}\n[完整结果共 ${serialized.length} 字符，中间已截断]\n${serialized.slice(-16000)}` }
      const size = Buffer.byteLength(JSON.stringify(safe)) + 512
      if (bytes && bytes + size > maxBytes) { destination.flushSync(); destination.end(); open(actualRoot) }
      logger[level]({ event, data: safe })
      bytes += size
    } catch { failed = true; process.stderr.write('PLC Pilot 诊断日志写入中断，请检查磁盘空间。\n') }
  }
  return {
    info: (event, data) => write('info', event, data), warn: (event, data) => write('warn', event, data), error: (event, data) => write('error', event, data),
    get path() { return filename },
    close: () => { if (destination && !failed) { destination.flushSync(); destination.end() } },
  }
}

/** 按完整行记录子进程输出，避免凭据恰好被管道分成两块时漏过过滤。 */
export function diagnosticTextSink(logger, event, context = {}) {
  let pending = ''
  return {
    write(chunk) {
      pending += chunk
      let index
      while ((index = pending.indexOf('\n')) !== -1) { logger.info(event, { ...context, text: pending.slice(0, index) }); pending = pending.slice(index + 1) }
      if (pending.length > 128 * 1024) { logger.info(event, { ...context, text: '[无换行输出超过 128 KB，已省略以避免凭据分段泄漏]' }); pending = '' }
    },
    end() { if (pending) logger.info(event, { ...context, text: pending }); pending = '' },
  }
}

export function observeProcess(logger) {
  logger.info('process.start', { node: process.version, platform: process.platform, architecture: process.arch, executable: process.execPath })
  process.on('uncaughtExceptionMonitor', (error, origin) => logger.error('process.crash', { error, origin }))
  process.on('warning', warning => logger.warn('process.warning', { warning }))
  process.once('exit', code => { logger.info('process.exit', { code }); logger.close() })
}
