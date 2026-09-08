import { invoke, isTauri } from '@tauri-apps/api/core'
import type { ComposerDraftPayload } from '../components/content/ThreadComposer.vue'

const pending = new Map<string, { payload: ComposerDraftPayload; timer: ReturnType<typeof setTimeout> }>()
const writes = new Map<string, Promise<void>>()
const cache = new Map<string, ComposerDraftPayload>()
const storageKey = (id: string) => `plc-pilot.thread-draft.v2.${id}`

/** 大附件草稿保存在应用自有目录；写入按会话串行，快速切换不会覆盖另一会话。 */
export function useComposerDraftStorage() {
  function flush(id: string): Promise<void> {
    const item = pending.get(id)
    if (!item) return writes.get(id) ?? Promise.resolve()
    clearTimeout(item.timer); pending.delete(id)
    const write = (writes.get(id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (isTauri()) await invoke('save_composer_draft', { threadId: id, value: item.payload })
      else localStorage.setItem(storageKey(id), JSON.stringify(item.payload))
    })
    writes.set(id, write)
    void write.finally(() => { if (writes.get(id) === write) writes.delete(id) }).catch(() => undefined)
    return write
  }
  function save(id: string, payload: ComposerDraftPayload): void {
    cache.set(id, payload)
    const old = pending.get(id)
    if (old) clearTimeout(old.timer)
    pending.set(id, { payload, timer: setTimeout(() => void flush(id).catch((error) => console.error('草稿保存未完成', error)), 250) })
  }
  async function read(id: string): Promise<ComposerDraftPayload | null> {
    if (cache.has(id)) return cache.get(id)!
    if (isTauri()) {
      const value = await invoke<ComposerDraftPayload | null>('load_composer_draft', { threadId: id })
      if (value) { cache.set(id, value); return value }
    }
    const legacy = localStorage.getItem(storageKey(id))
    if (!legacy) return null
    const value = JSON.parse(legacy) as ComposerDraftPayload
    if (isTauri()) save(id, value)
    return value
  }
  /** 安装退出前排空所有会话的防抖写入，避免最近 250ms 的文字和附件丢失。 */
  async function flushAll(): Promise<void> {
    await Promise.all([...new Set([...pending.keys(), ...writes.keys()])].map(flush))
  }
  return { save, read, flush, flushAll }
}
