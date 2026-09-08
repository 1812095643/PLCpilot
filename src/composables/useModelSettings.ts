import { shallowRef, type ShallowRef } from 'vue'
import { getModelSettings, type Snapshot } from '../api/plcBridge'

/** 只从桌面读取已持久化模型，不让 MCP 探测阻塞配置恢复或用空默认值覆盖设置。 */
export function useModelSettings(snapshot: ShallowRef<Snapshot>) {
  const loaded = shallowRef(false)
  const error = shallowRef('')
  let pending: Promise<void> | null = null

  function reload(): Promise<void> {
    if (pending) return pending
    pending = (async () => {
      try {
        const settings = await getModelSettings()
        snapshot.value = { ...snapshot.value, ...settings }
        loaded.value = true
        error.value = ''
      } catch (cause) {
        error.value = `模型配置暂时未读取，请重试。${String(cause)}`
      } finally { pending = null }
    })()
    return pending
  }

  return { loaded, error, reload }
}
