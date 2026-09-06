import { readonly, shallowRef } from 'vue'

const FRAME_INTERVAL_MS = 16
const TARGET_DRAIN_FRAMES = 30

/**
 * 把后端真实 delta 转换成稳定可见的逐帧文本流。
 *
 * 供应商会以不均匀的 token 块发送 delta；这里只平滑已经收到的增量，不能补救
 * 非流式后端。实际“等待结束才出现内容”的根因在宿主启动失败后的旧回退链路。
 * 这里不生成任何假内容，只把已经收到的真实 delta 放入缓冲区，并保证最终消息
 * 落地前缓冲已经可见地排空。新 assistant 流开始时会清理上一个工具轮次或失败
 * 尝试的文字，避免不同模型请求被拼接到同一条回复。
 */
export function useAgentTextStream() {
  const activeRequestId = shallowRef('')
  const displayedText = shallowRef('')
  let pendingText = ''
  let frameTimer: number | undefined
  let drainResolvers: Array<() => void> = []

  function resolveDrainWaiters(): void {
    if (pendingText.length > 0 || frameTimer !== undefined) return
    const resolvers = drainResolvers
    drainResolvers = []
    for (const resolve of resolvers) resolve()
  }

  function cancelFrame(): void {
    if (frameTimer === undefined) return
    window.clearTimeout(frameTimer)
    frameTimer = undefined
  }

  function renderFrame(): void {
    frameTimer = undefined
    if (!pendingText) {
      resolveDrainWaiters()
      return
    }
    // 自适应批量：短 token 保留打字感，大段积压仍能在约半秒内追上实时输出。
    const characterCount = Math.max(1, Math.ceil(pendingText.length / TARGET_DRAIN_FRAMES))
    displayedText.value += pendingText.slice(0, characterCount)
    pendingText = pendingText.slice(characterCount)
    frameTimer = window.setTimeout(renderFrame, FRAME_INTERVAL_MS)
  }

  function scheduleFrame(): void {
    if (frameTimer !== undefined || !pendingText) return
    frameTimer = window.setTimeout(renderFrame, FRAME_INTERVAL_MS)
  }

  function start(requestId: string): void {
    cancelFrame()
    activeRequestId.value = requestId
    displayedText.value = ''
    pendingText = ''
    resolveDrainWaiters()
  }

  function reset(requestId: string): void {
    if (!requestId || requestId !== activeRequestId.value) return
    cancelFrame()
    displayedText.value = ''
    pendingText = ''
    resolveDrainWaiters()
  }

  function append(requestId: string, delta: string): void {
    if (!delta || requestId !== activeRequestId.value) return
    pendingText += delta
    scheduleFrame()
  }

  function flush(requestId: string, immediate = false): Promise<void> {
    if (requestId !== activeRequestId.value) return Promise.resolve()
    if (immediate && pendingText) {
      cancelFrame()
      displayedText.value += pendingText
      pendingText = ''
    }
    if (!pendingText && frameTimer === undefined) return Promise.resolve()
    scheduleFrame()
    return new Promise((resolve) => drainResolvers.push(resolve))
  }

  function stop(requestId: string): void {
    if (requestId !== activeRequestId.value) return
    cancelFrame()
    pendingText = ''
    activeRequestId.value = ''
    resolveDrainWaiters()
  }

  return {
    activeRequestId: readonly(activeRequestId),
    displayedText: readonly(displayedText),
    start,
    reset,
    append,
    flush,
    stop,
  }
}
