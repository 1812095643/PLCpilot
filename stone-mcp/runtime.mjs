import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { existsSync, statSync, readdirSync } from 'node:fs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bridgeManifest } from './catalog.mjs'
import { diagnosticTextSink } from '../shared/diagnostics.mjs'

const MAX_OUTPUT = 2 * 1024 * 1024
const MAX_MESSAGE = 8 * 1024 * 1024
const stoppedMessage = 'STone 会话已结束；请重新打开解决方案。未自动重放任何写入、下载或设备操作。'

/** 只检测真实安装，不以 Node/普通 Python 伪装官方 SToneCLI。 */
export function findStoneCli(env = process.env) {
  if (env.STONE_CLI_PATH?.trim()) {
    const path = resolve(env.STONE_CLI_PATH.trim().replace(/^"|"$/g, ''))
    return isAbsolute(env.STONE_CLI_PATH.trim().replace(/^"|"$/g, '')) && basename(path).toLowerCase() === 'stonecli.exe' && existsSync(path) && statSync(path).isFile() ? path : null
  }
  const candidates = (env.PATH || '').split(delimiter).filter(Boolean).map(root => join(root, 'SToneCLI.exe'))
  for (const root of [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean)) {
    const carel = join(root, 'CAREL')
    candidates.push(join(carel, 'STone', 'SToneCLI.exe'))
    try { for (const entry of readdirSync(carel, { withFileTypes: true })) if (entry.isDirectory() && /^stone/i.test(entry.name)) candidates.push(join(carel, entry.name, 'SToneCLI.exe')) } catch { /* 没有该安装目录时继续检查下一处。 */ }
  }
  return candidates.find(path => existsSync(path) && statSync(path).isFile()) ?? null
}

export function requireStoneCli() {
  const path = findStoneCli()
  if (!path) throw new Error('没有找到 SToneCLI.exe。请安装 CAREL STone（含对应 API/许可），在 MCP 环境变量 STONE_CLI_PATH 中填写完整路径后重新连接。官方 API 检索仍可离线使用。')
  if (process.platform !== 'win32') throw new Error('STone 工程自动化需要安装了 CAREL STone 的 Windows；当前系统可使用官方 API 检索。')
  return path
}

export function requireAbsolutePath(path, { exists = true, directory = false, extension } = {}) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw new Error('请提供不含空字符的完整绝对路径。')
  if (extension && !path.toLowerCase().endsWith(extension)) throw new Error(`请选择 ${extension} 文件。`)
  if (exists && (!existsSync(path) || (directory ? !statSync(path).isDirectory() : !statSync(path).isFile()))) throw new Error(`没有找到${directory ? '目录' : '文件'}：${path}`)
  return path
}

export async function killProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32' && child.pid) {
    await new Promise(resolveDone => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.once('error', resolveDone)
      killer.once('close', resolveDone)
    })
  }
  if (child.exitCode === null && child.signalCode === null) child.kill()
}

/** argv 独立传递且 shell=false，文件名和参数中的引号不会变成命令。 */
export async function runProcess(executable, args, { timeoutMs = 90000, signal, onOutput, onChild, logger } = {}) {
  signal?.throwIfAborted()
  return new Promise((resolveDone, reject) => {
    const child = spawn(executable, args, { cwd: dirname(executable), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    onChild?.(child)
    logger?.info('cli.start', { executable, args, pid: child.pid, timeoutMs })
    let stdout = '', stderr = '', outputTruncated = false, failure = null
    const terminate = reason => { failure ??= reason; logger?.error('cli.interrupt', { pid: child.pid, reason }); void killProcessTree(child) }
    const onAbort = () => terminate(new Error('用户已取消 STone 调用；操作可能已部分执行，请检查工程或目标状态。'))
    const timer = setTimeout(() => terminate(new Error('STone 调用超时，已终止本次 CLI；操作结果可能不完整，请检查后再决定是否重试。')), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    for (const [stream, kind] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      const sink = logger ? diagnosticTextSink(logger, `cli.${kind}`, { pid: child.pid }) : null
      stream.on('end', () => sink?.end())
      stream.setEncoding('utf8')
      stream.on('data', text => {
        sink?.write(text)
        if (kind === 'stdout') { outputTruncated ||= stdout.length + text.length > MAX_OUTPUT; stdout = (stdout + text).slice(-MAX_OUTPUT) }
        else { outputTruncated ||= stderr.length + text.length > MAX_OUTPUT; stderr = (stderr + text).slice(-MAX_OUTPUT) }
        onOutput?.(text, kind)
      })
    }
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
    child.once('error', error => { cleanup(); logger?.error('cli.spawn.error', { error }); reject(new Error(`无法启动 SToneCLI：${error.message}`)) })
    child.once('close', (code, processSignal) => {
      cleanup()
      logger?.info('cli.exit', { pid: child.pid, code: code === null ? null : code | 0, signal: processSignal, outputTruncated, interrupted: Boolean(failure) })
      if (failure) reject(failure)
      else resolveDone({ exitCode: code === null ? null : code | 0, signal: processSignal, stdout, stderr, outputTruncated })
    })
    if (signal?.aborted) onAbort()
  })
}

export class StoneRuntime {
  constructor(logger) {
    this.logger = logger
    this.queue = Promise.resolve()
    this.pending = new Map()
    this.sockets = new Set()
    this.sequence = 0
    this.state = {}
    this.logs = ''
  }

  /** 同一官方对象不可并发修改；排队中的取消不会启动任何 CLI。 */
  serial(action, signal) {
    const result = this.queue.then(() => { signal?.throwIfAborted(); return action() })
    this.queue = result.catch(() => {})
    return result
  }

  status() { return { running: Boolean(this.socket && !this.socket.destroyed), pid: this.child?.pid ?? null, ...this.state } }

  async start(signal, timeoutMs) {
    if (this.socket && !this.socket.destroyed) return
    const executable = requireStoneCli()
    this.logger?.info('bridge.start', { executable, timeoutMs })
    await this.stop()
    signal?.throwIfAborted()
    this.logs = ''
    this.state = {}
    this.temporaryRoot = await mkdtemp(join(tmpdir(), 'plc-pilot-stone-'))
    const token = randomBytes(32).toString('hex')
    let resolveReady, rejectReady
    const ready = new Promise((resolveDone, reject) => { resolveReady = resolveDone; rejectReady = reject })
    // ready 可能在配置文件写入期间已被拒绝，先挂接处理器避免未处理拒绝。
    void ready.catch(() => {})
    this.listener = createServer(socket => {
      this.sockets.add(socket)
      let authenticated = false, buffer = ''
      socket.setEncoding('utf8')
      socket.setTimeout(5000, () => { if (!authenticated) socket.destroy() })
      socket.on('data', chunk => {
        buffer += chunk
        if (Buffer.byteLength(buffer) > MAX_MESSAGE) { socket.destroy(); return }
        let end
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
          try {
            const message = JSON.parse(line)
            if (!authenticated) {
              if (message.token !== token || message.type !== 'ready' || this.socket) { socket.destroy(); return }
              authenticated = true
              socket.setTimeout(0)
              this.socket = socket
              this.logger?.info('bridge.ready', { pid: this.child?.pid })
              // 握手后停止接受新连接，随机凭证仅存在临时配置中。
              this.listener.close()
              resolveReady()
            } else {
              const pending = this.pending.get(message.id)
              if (!pending) continue
              this.state = message.state ?? this.state
              this.pending.delete(message.id)
              if (message.error) pending.reject(new Error(message.error))
              else pending.resolve({ ...message.data, session: this.state })
            }
          } catch { socket.destroy() }
        }
      })
      socket.on('error', error => this.logger?.error('bridge.socket.error', { error }))
      socket.on('close', () => {
        this.sockets.delete(socket)
        if (socket === this.socket) {
          this.logger?.warn('bridge.disconnected', { pid: this.child?.pid, pending: this.pending.size })
          this.socket = null
          this.state = {}
          for (const pending of this.pending.values()) pending.reject(new Error(stoppedMessage))
          this.pending.clear()
        }
      })
    })
    try {
      await new Promise((resolveDone, reject) => { this.listener.once('error', reject); this.listener.listen(0, '127.0.0.1', resolveDone) })
      const configPath = join(this.temporaryRoot, 'connection.json')
      await writeFile(configPath, JSON.stringify({ port: this.listener.address().port, token, manifest: bridgeManifest }), { encoding: 'utf8', mode: 0o600 })
      const script = fileURLToPath(new URL('./bridge.py', import.meta.url))
      const child = spawn(executable, ['iron-python', '-f', script, '-a', configPath], { cwd: dirname(executable), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      this.child = child
      for (const [stream, kind] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
        const sink = this.logger ? diagnosticTextSink(this.logger, `bridge.${kind}`, { pid: child.pid }) : null
        stream.setEncoding('utf8'); stream.on('data', text => { this.logs = (this.logs + text).slice(-8000); sink?.write(text) }); stream.on('end', () => sink?.end())
      }
      child.once('error', error => rejectReady(new Error(`无法启动官方 IronPython：${error.message}`)))
      child.once('close', code => { this.logger?.info('bridge.exit', { pid: child.pid, code: code === null ? null : code | 0 }); rejectReady(new Error(`官方 IronPython 未建立连接（退出码 ${code === null ? null : code | 0}）。请检查 STone/API 许可。${this.logs}`)); if (child === this.child) this.socket?.destroy() })
      const timer = setTimeout(() => rejectReady(new Error(`STone IronPython 在限定时间内未就绪，请检查安装及许可。${this.logs}`)), Math.min(timeoutMs, 45000))
      const abort = () => rejectReady(new Error('已取消 STone 会话启动。'))
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      try { await ready } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    } catch (error) { this.logger?.error('bridge.start.error', { error }); await this.stop(); throw error }
  }

  call(request, { signal, timeoutMs = 90000 } = {}) {
    return this.serial(async () => {
      const started = Date.now()
      await this.start(signal, timeoutMs)
      signal?.throwIfAborted()
      return new Promise((resolveDone, reject) => {
        const id = ++this.sequence
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(id) }
        const fail = message => { this.logger?.error('bridge.call.interrupt', { id, message }); cleanup(); reject(new Error(message)); void this.stop() }
        const timer = setTimeout(() => fail('STone 调用超时，当前会话已终止。操作可能部分完成，请检查工程后重新打开；不会自动重试。'), Math.max(1, timeoutMs - (Date.now() - started)))
        const abort = () => fail('已取消 STone 调用。当前会话已终止，请检查可能的部分修改。')
        this.pending.set(id, { resolve: data => { cleanup(); resolveDone(data) }, reject: error => { cleanup(); reject(error) } })
        signal?.addEventListener('abort', abort, { once: true })
        this.socket.write(`${JSON.stringify({ ...request, id })}\n`, error => { if (error) fail(error.message) })
        if (signal?.aborted) abort()
      })
    }, signal)
  }

  cli(args, options = {}) {
    return this.serial(async () => {
      if (this.state.solutionOpen) throw new Error('IronPython 当前已打开工程。请先保存并调用 stone_solution_close，避免两个 CLI 同时访问工程文件。')
      const executable = requireStoneCli()
      try { return await runProcess(executable, args, { ...options, logger: this.logger, onChild: child => { this.cliChild = child } }) }
      finally { this.cliChild = null }
    }, options.signal)
  }

  async stop() {
    if (this.child || this.cliChild) this.logger?.info('runtime.stop', { pid: this.child?.pid, cliPid: this.cliChild?.pid, state: this.state })
    // 先断开通道让正常执行中的桥接清理连接；再收回 CLI 子进程树，不留下常驻端口。
    const child = this.child, cliChild = this.cliChild, root = this.temporaryRoot
    this.child = null; this.cliChild = null; this.temporaryRoot = null
    for (const pending of this.pending.values()) pending.reject(new Error(stoppedMessage))
    this.pending.clear()
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear(); this.socket = null
    if (this.listener?.listening) this.listener.close()
    this.listener = null; this.state = {}
    await Promise.all([killProcessTree(child), killProcessTree(cliChild)])
    if (root) await rm(root, { recursive: true, force: true })
  }
}
