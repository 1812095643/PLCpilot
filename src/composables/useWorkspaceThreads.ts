import { computed, shallowReactive, shallowRef, toRefs, watch, type WritableComputedRef } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { EMPTY_SNAPSHOT, type ProjectContext, type SessionSummary, type Diagnostic, type PendingChange } from '../api/plcBridge'
import type { UiMessage, UiLiveOverlay, UiResponseTextAnnotation, ReasoningEffort, CollaborationModeKind } from '../types/codex'
import type { SubmitPayload } from '../components/content/ThreadComposer.vue'
import { useAgentTextStream } from './useAgentTextStream'

export type WorkspaceThread = {
  id: string
  project: ProjectContext
  session: SessionSummary
  messages: UiMessage[]
  pendingChanges: PendingChange[]
  pendingResponseAnnotations: UiResponseTextAnnotation[]
  diagnostics: Diagnostic[]
  diagnosticNote: string
  isBusy: boolean
  liveOverlay: UiLiveOverlay | null
  streamingRequestId: string
  streamingAssistantId: string
  selectedModel: string
  selectedModelProfileId: string
  reasoningEffort: ReasoningEffort
  collaborationMode: CollaborationModeKind
  queuedSubmits: Array<{ id: string; payload: SubmitPayload; steering?: boolean }>
  isDrainingSubmitQueue: boolean
  queuePaused: boolean
  textStream: ReturnType<typeof useAgentTextStream>
}

/** 会话对象在导航切换后保持原引用，后台回调始终只更新自己所属的会话。 */
export function useWorkspaceThreads() {
  const threads = shallowRef<WorkspaceThread[]>([])
  const activeId = shallowRef('')
  let hydrated = false
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  function create(project: ProjectContext, id = `local-${crypto.randomUUID()}`): WorkspaceThread {
    const previous = threads.value.find((thread) => thread.id === activeId.value)
    const thread = shallowReactive<WorkspaceThread>({
      id, project, session: { ...EMPTY_SNAPSHOT.session, tokens: { ...EMPTY_SNAPSHOT.session.tokens } },
      messages: [], pendingChanges: [], pendingResponseAnnotations: [], diagnostics: [], diagnosticNote: '', isBusy: false,
      liveOverlay: null, streamingRequestId: '', streamingAssistantId: '',
      selectedModel: previous?.selectedModel || '', selectedModelProfileId: previous?.selectedModelProfileId || '', reasoningEffort: previous?.reasoningEffort || 'medium', collaborationMode: 'default',
      queuedSubmits: [], isDrainingSubmitQueue: false, queuePaused: false, textStream: useAgentTextStream(),
    })
    threads.value = [...threads.value, thread]
    activeId.value = id
    return thread
  }

  create({ ...EMPTY_SNAPSHOT.project })
  const active = computed(() => threads.value.find((thread) => thread.id === activeId.value) ?? threads.value[0]!)

  function field<K extends keyof WorkspaceThread>(key: K): WritableComputedRef<WorkspaceThread[K]> {
    return computed({ get: () => active.value[key], set: (value) => { active.value[key] = value } })
  }

  function select(thread: WorkspaceThread): void { activeId.value = thread.id }
  function remove(thread: WorkspaceThread): void {
    if (thread.isBusy) return
    threads.value = threads.value.filter((item) => item !== thread)
    if (!threads.value.length) create({ ...EMPTY_SNAPSHOT.project })
    if (activeId.value === thread.id) activeId.value = threads.value[0]!.id
  }

  async function restore(): Promise<boolean> {
    try {
      const saved = await invoke<{ activeId?: string; threads?: Array<Partial<WorkspaceThread>> } | null>('load_workspace_state')
      if (!saved?.threads?.length) return false
      threads.value = []
      for (const entry of saved.threads) {
        if (!entry.id || !entry.project || !Array.isArray(entry.messages)) continue
        const thread = create(entry.project, entry.id)
        for (const key of ['session', 'messages', 'pendingResponseAnnotations', 'selectedModel', 'selectedModelProfileId', 'reasoningEffort', 'collaborationMode', 'queuedSubmits'] as const) {
          if (entry[key] !== undefined) Object.assign(thread, { [key]: entry[key] })
        }
        thread.queuePaused = thread.queuedSubmits.length > 0
        thread.queuedSubmits = thread.queuedSubmits.map((item) => ({ ...item, steering: false }))
        thread.messages = thread.messages.map((message) => message.messageType === 'agentMessage.live'
          ? { ...message, messageType: 'assistant.partial' }
          : message.commandExecution?.status === 'inProgress'
            ? { ...message, commandExecution: { ...message.commandExecution, status: 'interrupted' } }
            : message)
      }
      if (!threads.value.length) return false
      activeId.value = threads.value.some((thread) => thread.id === saved.activeId) ? saved.activeId! : threads.value[0]!.id
      return true
    } finally {
      if (!threads.value.length) create({ ...EMPTY_SNAPSHOT.project })
      hydrated = true
    }
  }

  function persist(): Promise<void> {
    if (!hydrated) return Promise.resolve()
    const state = { activeId: activeId.value, threads: threads.value.map(({ textStream: _stream, ...thread }) => ({
      ...thread, isBusy: false, liveOverlay: null, streamingRequestId: '', streamingAssistantId: '',
    })) }
    return invoke('save_workspace_state', { value: state })
  }

  watch(() => [activeId.value, ...threads.value.flatMap((thread) => [thread.messages, thread.session, thread.queuedSubmits, thread.selectedModelProfileId, thread.reasoningEffort])], () => {
    if (!hydrated) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void persist().catch((error) => console.error('会话界面状态保存未完成', error)), 500)
  })

  return { threads, active, activeId, create, select, remove, field, restore, persist, refs: (thread: WorkspaceThread) => toRefs(thread) }
}
