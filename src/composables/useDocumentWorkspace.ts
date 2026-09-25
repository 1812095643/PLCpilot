import { computed, onBeforeUnmount, onMounted, shallowRef, type Ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from '@tauri-apps/api/core'
import { closeDocument, openDocument, getDocument, applyDocument, saveDocument, documentHistory, type DocumentSnapshot, type DocumentOperation } from '../api/documents'
import type { UiAttachment } from '../types/codex'

/** 标签绑定原会话，异步读取完成时不能切换另一会话的预览。 */
export function useDocumentWorkspace(scope: Ref<string>, notice: (message: string) => void) {
  const entries = shallowRef<DocumentSnapshot[]>([])
  const activeIds = shallowRef<Record<string, string>>({})
  const visibleScopes = shallowRef(new Set<string>())
  const loadingScopes = shallowRef(new Set<string>())
  const tabs = computed(() => entries.value.filter(entry => entry.scope === scope.value))
  const active = computed(() => tabs.value.find(entry => entry.id === activeIds.value[scope.value]) ?? tabs.value[0] ?? null)
  const visible = computed(() => visibleScopes.value.has(scope.value))
  const loading = computed(() => loadingScopes.value.has(scope.value))
  let disposed = false
  const busyIds = shallowRef(new Set<string>())
  const busy = computed(() => Boolean(active.value && busyIds.value.has(active.value.id)))
  let unsubscribe: (() => void) | undefined
  const requests = new Map<string, number>()

  async function open(input: { path?: string; attachment?: UiAttachment }) {
    const owner = scope.value
    const request = (requests.get(owner) ?? 0) + 1
    requests.set(owner, request)
    visibleScopes.value = new Set([...visibleScopes.value, owner])
    loadingScopes.value = new Set([...loadingScopes.value, owner])
    try {
      const entry = await openDocument(owner, input)
      if (disposed) { await closeDocument(entry.id, owner); return }
      entries.value = [...entries.value.filter(item => item.id !== entry.id), entry]
      if (requests.get(owner) === request) activeIds.value = { ...activeIds.value, [owner]: entry.id }
    } catch (error) { notice(String(error)) }
    finally { if (requests.get(owner) === request) loadingScopes.value = new Set([...loadingScopes.value].filter(value => value !== owner)) }
  }
  function select(id: string) { if (tabs.value.some(entry => entry.id === id)) activeIds.value = { ...activeIds.value, [scope.value]: id } }
  async function close(id: string) {
    const entry = entries.value.find(item => item.id === id)
    if (!entry) return
    if (entry.dirty) { notice('文件有未保存修改，请先保存，或撤回到已保存版本后关闭。'); return }
    try {
      await closeDocument(id, entry.scope)
      entries.value = entries.value.filter(item => item.id !== id)
      if (!tabs.value.length) hide()
    } catch (error) { notice(String(error)) }
  }
  function hide() { visibleScopes.value = new Set([...visibleScopes.value].filter(value => value !== scope.value)) }
  function show() { visibleScopes.value = new Set([...visibleScopes.value, scope.value]) }
  function replace(entry: DocumentSnapshot) { entries.value = entries.value.map(item => item.id === entry.id ? entry : item) }
  async function update(action: (entry: DocumentSnapshot) => Promise<DocumentSnapshot>) {
    const entry = active.value
    if (!entry || busyIds.value.has(entry.id)) return
    busyIds.value = new Set([...busyIds.value, entry.id])
    try { replace(await action(entry)) } catch (error) { notice(String(error)) }
    finally { busyIds.value = new Set([...busyIds.value].filter(id => id !== entry.id)) }
  }
  const apply = (operations: DocumentOperation[]) => update(entry => applyDocument(entry, operations))
  const save = () => update(saveDocument)
  const history = (redo: boolean) => update(entry => documentHistory(entry, redo))
  onMounted(async () => {
    if (!isTauri()) return
    const stop = await listen<{ id: string; scope: string }>('document-changed', async ({ payload }) => {
      if (!entries.value.some(entry => entry.id === payload.id) || busyIds.value.has(payload.id)) return
      try { const value = await getDocument(payload.id, payload.scope); if (!disposed) replace(value) } catch { /* 已关闭的标签无需恢复。 */ }
    })
    if (disposed) stop(); else unsubscribe = stop
  })
  onBeforeUnmount(() => { disposed = true; unsubscribe?.(); for (const entry of entries.value) void closeDocument(entry.id, entry.scope).catch(() => {}) })
  return { tabs, active, visible, loading, busy, open, select, close, hide, show, replace, apply, save, history }
}
