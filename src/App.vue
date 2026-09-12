<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, shallowRef, watch, type ComponentPublicInstance } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import DesktopLayout from './components/layout/DesktopLayout.vue'
import WindowTitleBar from './components/layout/WindowTitleBar.vue'
import SidebarThreadControls from './components/sidebar/SidebarThreadControls.vue'
import WorkspaceSidebar, { type SidebarThread } from './components/sidebar/WorkspaceSidebar.vue'
import ContentHeader from './components/content/ContentHeader.vue'
import ThreadConversation from './components/content/ThreadConversation.vue'
import CodesysStatusPanel from './components/content/CodesysStatusPanel.vue'
import type { ThreadConversationExposed } from './components/content/ThreadConversation.vue'
import ThreadComposer from './components/content/ThreadComposer.vue'
import ComposerQueue from './components/content/ComposerQueue.vue'
import ModelSettingsPanel from './components/settings/ModelSettingsPanel.vue'
import SettingsPage from './components/settings/SettingsPage.vue'
import UpdatesSettingsPanel from './components/settings/UpdatesSettingsPanel.vue'
import AppUpdateNotice from './components/settings/AppUpdateNotice.vue'
import { useAppUpdates } from './composables/useAppUpdates'
import { useComposerDraftStorage } from './composables/useComposerDraftStorage'
import type { ComposerDraftPayload, ThreadComposerExposed, SubmitPayload } from './components/content/ThreadComposer.vue'
import { useWorkspaceThreads, type WorkspaceThread } from './composables/useWorkspaceThreads'
import { useAppTheme } from './composables/useAppTheme'
import { useAccessMode } from './composables/useAccessMode'
import { hasTurnResponseText } from './utils/conversationTurns'
import { useModelSettings } from './composables/useModelSettings'
import IconTablerBolt from './components/icons/IconTablerBolt.vue'
import IconTablerSettings from './components/icons/IconTablerSettings.vue'
import IconTablerSearch from './components/icons/IconTablerSearch.vue'
import IconTablerTerminal from './components/icons/IconTablerTerminal.vue'
import IconTablerFolder from './components/icons/IconTablerFolder.vue'
import IconTablerFilePencil from './components/icons/IconTablerFilePencil.vue'
import IconTablerTrash from './components/icons/IconTablerTrash.vue'
import IconTablerX from './components/icons/IconTablerX.vue'
import { normalizePathForUi } from './pathUtils'
import {
  approveChange,
  abortAgent,
  steerAgent,
  compactContext,
  compileProject,
  deleteModel,
  duplicateModel,
  EMPTY_SNAPSHOT,
  getSkillContent,
  getSnapshot,
  deleteSession,
  forkSession,
  pickProjectFolder,
  removeProject,
  renameSession,
  rejectChange,
  resumeSession,
  runAgent,
  saveMcp,
  saveModel,
  setActiveModel,
  setModelEnabled,
  setWorkbenchMode,
  selectProject,
  startNewSession,
  startTemporaryWorkspace,
  syncCurrentProject,
  type AgentEvent,
  type AgentStreamPayload,
  type AgentResult,
  type AgentRunOptions,
  type CommandSummary,
  type McpForm,
  type ModelForm,
  type ModelSummary,
  type WorkbenchMode,
  type PendingChange,
  type SessionRecord,
  type Snapshot,
  type WorkspaceProject,
} from './api/plcBridge'
import type {
  CollaborationModeKind,
  UiAttachment,
  UiLiveOverlay,
  UiMessage,
  UiMentionReference,
  UiResponseTextAnnotation,
  UiRetryPayload,
  UiThreadTokenUsage,
} from './types/codex'
import type { Diagnostic } from './api/plcBridge'

type View = 'chat' | 'overview' | 'skills'

const snapshot = shallowRef<Snapshot>(EMPTY_SNAPSHOT)
const modelSettings = useModelSettings(snapshot)
const isSavingModel = shallowRef(false)
const workspace = useWorkspaceThreads()
const tasksRunning = computed(() => workspace.threads.value.some((thread) => thread.isBusy || thread.isDrainingSubmitQueue || (!thread.queuePaused && thread.queuedSubmits.length > 0)))
const updater = useAppUpdates(async () => {
  await nextTick()
  await useComposerDraftStorage().flushAll()
  await workspace.persist()
}, () => tasksRunning.value)
const messages = workspace.field('messages')
/** 当前 Composer 中等待随下一条用户消息发送的回复批注。 */
const pendingResponseAnnotations = workspace.field('pendingResponseAnnotations')
const activeView = shallowRef<View>('chat')
const activeThreadId = workspace.activeId
const isSidebarCollapsed = shallowRef(false)
const isBusy = workspace.field('isBusy')
const isWindowDropActive = shallowRef(false)
const isRefreshing = shallowRef(false)
const notice = shallowRef('')
const providerDiscoveryRequest = shallowRef(0)
const workbenchMode = shallowRef<WorkbenchMode>('codesys')
const liveOverlay = workspace.field('liveOverlay')
const diagnostics = workspace.field('diagnostics')
const diagnosticNote = workspace.field('diagnosticNote')
const showSettings = shallowRef(false)
const settingsCategory = shallowRef('models')
const showCommandPalette = shallowRef(false)
const showAbout = shallowRef(false)
const showReward = shallowRef(false)
const GITHUB_REPOSITORY_URL = 'https://github.com/1812095643/PLCpilot'
type AppDialog = { kind: 'confirm' | 'prompt'; title: string; message: string; value: string; resolve: (value: boolean | string | null) => void } | null
const appDialog = shallowRef<AppDialog>(null)
const showSkillDetail = shallowRef(false)
const selectedSkillId = shallowRef('')
const selectedSkillContent = shallowRef('')
const projectPathDraft = shallowRef('')
const composerRef = shallowRef<ComponentPublicInstance<ThreadComposerExposed> | null>(null)
const conversationRef = shallowRef<ComponentPublicInstance<ThreadConversationExposed> | null>(null)
const { preference: theme } = useAppTheme()
const { mode: accessMode, ready: accessModeReady, saving: accessModeSaving, update: saveComposerAccessMode } = useAccessMode(showNotice)

async function onWorkbenchModeChange(mode: WorkbenchMode): Promise<void> {
  if (mode === workbenchMode.value || isRefreshing.value || tasksRunning.value) return
  try {
    const project = await setWorkbenchMode(mode)
    workbenchMode.value = mode
    // 空白临时会话尚未绑定目录；切换模式返回的是运行时的上一个工程，
    // 不能把它填入空白会话，否则首次发送会误用旧工程而跳过目录初始化。
    if (workspace.active.value.project.path) workspace.active.value.project = project
    activeView.value = mode === 'codesys' ? 'overview' : 'chat'
    void refresh().catch(() => undefined)
    showNotice(mode === 'codesys' ? '已切换到 CODESYS 模式。' : mode === 'stone' ? '已切换到 Stone 模式。' : '已切换到自由聊天模式。')
  } catch (error) { showNotice(error instanceof Error ? error.message : String(error)) }
}

async function onAccessModeChange(mode: 'approval' | 'full'): Promise<void> {
  if (mode === accessMode.value || tasksRunning.value || accessModeSaving.value) return
  // 与 Codex permissions_menu/permission_popups 一致，完全访问是显式选择并确认，
  // 不会因打开菜单或切换会话自动升级；两个入口共用保存结果，失败时保持旧模式。
  if (mode === 'full' && !await requestConfirm('启用完全访问？', '已启用工具将直接修改文件、运行命令及执行 CODESYS 在线操作，无需逐项审批。此设置适用于所有项目的新任务；计划模式仍只读。')) return
  if (tasksRunning.value) return
  if (await saveComposerAccessMode(mode)) showNotice(mode === 'full' ? '已启用完全访问。' : '已恢复审批模式。')
}
const collaborationMode = workspace.field('collaborationMode')
const selectedModel = workspace.field('selectedModel')
const selectedModelProfileId = workspace.field('selectedModelProfileId')
const reasoningEffort = workspace.field('reasoningEffort')
const queuedSubmits = workspace.field('queuedSubmits')
const queuePaused = workspace.field('queuePaused')
const mcpForm = shallowRef<McpForm>({
  id: 'codesys',
  name: 'CODESYS MCP',
  command: '',
  args: '',
  transport: 'stdio',
  url: '',
  authToken: '',
})

function requestConfirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => { appDialog.value = { kind: 'confirm', title, message, value: '', resolve: (value) => resolve(Boolean(value)) } })
}

function requestPrompt(title: string, message: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => { appDialog.value = { kind: 'prompt', title, message, value, resolve: (result) => resolve(typeof result === 'string' ? result : null) } })
}

function closeAppDialog(result: boolean | string | null): void {
  const dialog = appDialog.value
  appDialog.value = null
  dialog?.resolve(result)
}

function openGithubRepository(): void {
  window.open(GITHUB_REPOSITORY_URL, '_blank', 'noopener,noreferrer')
}

const fallbackCommands: CommandSummary[] = [
  { command: '/help', label: '帮助', detail: '查看命令和安全边界', category: 'session', supports_args: false },
  { command: '/status', label: '运行状态', detail: '工程、模型和会话状态', category: 'session', supports_args: false },
  { command: '/sessions', label: '会话历史', detail: '列出本机保存的工作会话', category: 'session', supports_args: false },
  { command: '/projects', label: '项目列表', detail: '查看最近打开的工程目录', category: 'project', supports_args: false },
  { command: '/rename', label: '重命名会话', detail: '给当前会话设置一个易识别的名称', category: 'session', supports_args: true },
  { command: '/clear', label: '清空会话', detail: '移除当前对话记录，不改工程文件', category: 'session', supports_args: false },
  { command: '/scan', label: '扫描工程', detail: '读取工程树和源对象', category: 'project', supports_args: false },
  { command: '/skills', label: 'Skills', detail: '查看内置 PLC Skills', category: 'tools', supports_args: true },
  { command: '/mcp', label: 'MCP', detail: '查看 MCP 服务和工具', category: 'tools', supports_args: true },
  { command: '/tools', label: '工具目录', detail: '列出可调用工具', category: 'tools', supports_args: false },
  { command: '/model', label: '获取模型', detail: '从当前接口读取 /models 或 /model 列表', category: 'tools', supports_args: false },
  { command: '/compact', label: '压缩上下文', detail: '保留关键结论并释放上下文', category: 'session', supports_args: true },
  { command: '/compile', label: '编译诊断', detail: '调用 CODESYS 编译/诊断闭环', category: 'project', supports_args: false },
  { command: '/diagnostics', label: '静态诊断', detail: '查看 IEC 61131-3 结构诊断和编译器执行边界', category: 'project', supports_args: false },
  { command: '/approve', label: '批准修改', detail: '执行审批卡片中的工程写入', category: 'safety', supports_args: true },
  { command: '/reject', label: '拒绝修改', detail: '丢弃审批卡片中的工程写入', category: 'safety', supports_args: true },
  { command: '/new', label: '新会话', detail: '清空当前对话，不改工程', category: 'session', supports_args: false },
  { command: '/stop', label: '停止任务', detail: '停止当前工具轮次', category: 'session', supports_args: false },
  { command: '/plan', label: '计划模式', detail: '以只读方式整理本轮执行计划', category: 'session', supports_args: true },
]

const commands = computed(() => snapshot.value.commands.length > 0 ? snapshot.value.commands : fallbackCommands)
const modelOptions = computed(() => {
  const configured = snapshot.value.models
    .filter((model) => model.enabled)
    .map((model) => ({ id: model.id, name: model.name, model: model.model, providerName: model.provider_name, providerId: model.provider_id }))
  return configured
})
const selectedModelProfile = computed<ModelSummary | null>(() => (
  snapshot.value.models.find((model) => model.id === selectedModelProfileId.value && model.enabled)
    ?? snapshot.value.models.find((model) => model.model === selectedModel.value && model.enabled)
    ?? null
))
const selectedReasoningEfforts = computed(() => {
  const supported = selectedModelProfile.value?.reasoning_levels ?? []
  const allowed = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
  const values = allowed.filter((value) => supported.includes(value))
  return values.length > 0 ? values : [...allowed]
})
const currentProject = computed(() => workspace.active.value.project)
const recentProjects = computed(() => snapshot.value.projects.filter((project) => !isSamePath(project.path, currentProject.value.path)))
const currentCwd = computed(() => currentProject.value.working_directory || currentProject.value.project_directory || currentProject.value.path || '')
const currentTitle = computed(() => workspace.active.value.session.name || currentProject.value.name || 'PLC Pilot')
const skills = computed(() => snapshot.value.skills.map((skill) => ({
  name: skill.name,
  displayName: skill.name,
  description: skill.description,
  path: skill.path || `builtin://${skill.id}`,
  scope: skill.scope,
  enabled: skill.enabled,
})))
const pendingChanges = computed(() => workspace.active.value.pendingChanges.filter((item) => item.status === 'pending'))
const tokenUsage = computed<UiThreadTokenUsage | null>(() => {
  const session = workspace.active.value.session
  const contextWindow = selectedModelProfile.value?.context_window || session.context_window || 0
  if (!contextWindow && !session.tokens.total) return null
  const breakdown = {
    totalTokens: session.tokens.total,
    inputTokens: session.tokens.input,
    cachedInputTokens: session.tokens.cache_read,
    outputTokens: session.tokens.output,
    reasoningOutputTokens: 0,
  }
  return {
    total: breakdown,
    last: breakdown,
    modelContextWindow: contextWindow || null,
    currentContextTokens: session.context_tokens,
    remainingContextTokens: contextWindow ? Math.max(0, contextWindow - session.context_tokens) : null,
    remainingContextPercent: contextWindow
      ? Math.max(0, Math.round((1 - session.context_tokens / contextWindow) * 100))
      : null,
  }
})

const agentContext = computed(() => ({
  snapshot_id: currentProject.value.snapshot_id,
  project_path: currentProject.value.path,
  project_directory: currentProject.value.project_directory,
  working_directory: currentProject.value.working_directory,
  project_key: currentProject.value.project_key,
  active_object: currentProject.value.active_object,
  active_file: currentProject.value.active_file,
}))

// 临时会话首次发送后才拥有工作目录并按项目分组；尚未发送的空白会话
// 保持无路径，与旧版本遗留的无路径线程一起显示在“其他会话”。
const sidebarProjects = computed(() => snapshot.value.projects)
const sidebarThreads = computed<SidebarThread[]>(() => {
  const locals = workspace.threads.value.map((thread) => ({
    id: thread.id,
    name: thread.session.name && thread.session.name !== thread.project.name ? thread.session.name : thread.messages.find((message) => message.role === 'user')?.text.slice(0, 36) || '新对话',
    cwd: thread.project.project_directory || thread.project.path || '', busy: thread.isBusy,
    status: thread.liveOverlay?.activityLabel || (thread.queuePaused ? '队列已暂停' : ''), persisted: Boolean(thread.session.session_file),
  }))
  const sessions = snapshot.value.sessions.filter((record) => !workspace.threads.value.some((thread) => thread.session.session_id === record.session_id)).map((record) => ({
    id: record.session_id, name: record.name || record.messages.find((message) => message.role === 'user')?.content.slice(0, 36) || '未命名会话',
    cwd: record.cwd || '', busy: false, status: '', persisted: true,
  }))
  return [...locals, ...sessions]
})

async function selectSidebarThread(id: string): Promise<void> {
  const thread = workspace.threads.value.find((item) => item.id === id)
  if (thread) {
    workspace.select(thread)
    activeView.value = 'chat'
    showSettings.value = false
    if (thread.project.path) await selectProject(thread.project.path).catch((error) => showNotice(String(error)))
    await refresh()
  } else {
    const record = snapshot.value.sessions.find((item) => item.session_id === id)
    if (record) await onResumeSession(record)
  }
}

function sidebarSessionRecord(id: string): SessionRecord | undefined {
  const thread = workspace.threads.value.find((item) => item.id === id)
  return snapshot.value.sessions.find((record) => record.session_id === (thread?.session.session_id || id))
}

async function renameSidebarThread(id: string): Promise<void> {
  const record = sidebarSessionRecord(id)
  if (record) await onRenameSession(record)
}

async function deleteSidebarThread(id: string): Promise<void> {
  const thread = workspace.threads.value.find((item) => item.id === id)
  if (thread?.isBusy) return
  const record = sidebarSessionRecord(id)
  if (record) await onDeleteSession(record)
  else if (thread) workspace.remove(thread)
}

function newId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

function isQueuedMessage(message: UiMessage): boolean {
  return message.messageType === 'queued' || message.messageType === 'queued-steering'
}

function messageAttachments(attachments: UiAttachment[]): UiAttachment[] {
  return attachments.map((attachment) => ({
    ...attachment,
    previewUrl: attachment.kind === 'image' && attachment.dataBase64
      ? `data:${attachment.mimeType};base64,${attachment.dataBase64}`
      : undefined,
  }))
}

function restoredImageAttachment(imageUrl: string, messageIndex: number, imageIndex: number): UiAttachment {
  const [header, encoded = ''] = imageUrl.split(',', 2)
  const mimeType = header.startsWith('data:')
    ? (header.slice(5).split(';', 1)[0] || 'application/octet-stream')
    : 'application/octet-stream'
  return {
    id: `restored-image-${messageIndex}-${imageIndex}`,
    name: `图片 ${imageIndex + 1}`,
    mimeType,
    size: Math.ceil(encoded.length * 0.75),
    kind: 'image',
    status: 'ready',
    dataBase64: encoded,
    previewUrl: imageUrl,
  }
}

function restoreSessionMessages(record: SessionRecord): UiMessage[] {
  let turnIndex = -1
  const restored = record.messages.map<UiMessage>((item, index) => {
    if (item.role === 'user') turnIndex += 1
    const normalizedTurnIndex = Math.max(0, turnIndex)
    const metadata = item.role === 'user' ? record.ui_turns?.find((entry) => entry.turn_index === normalizedTurnIndex) : undefined
    const restoredProfileId = item.model_profile_id || record.model_profile_id || undefined
    const restoredProfile = snapshot.value.models.find((model) => model.id === restoredProfileId)
    const responseAnnotations = (metadata?.response_annotations ?? item.response_annotations ?? [])
      .filter((annotation) => Boolean(annotation)
        && typeof annotation.selected_text === 'string'
        && typeof annotation.body === 'string'
        && annotation.selected_text.trim().length > 0
        && annotation.body.trim().length > 0)
      .map((annotation, annotationIndex): UiResponseTextAnnotation => ({
        id: annotation.id || `restored-response-annotation-${index}-${annotationIndex}`,
        sourceMessageId: annotation.source_message_id || `restored-${index}`,
        sourceMessageKey: annotation.source_message_key || undefined,
        sourceTurnIndex: annotation.source_turn_index ?? normalizedTurnIndex,
        selectedText: annotation.selected_text.trim(),
        body: annotation.body.trim(),
        createdAt: annotation.created_at || new Date().toISOString(),
      }))
    return {
      id: newId(item.role),
      role: item.role === 'assistant' ? 'assistant' : 'user',
      text: metadata?.text ?? item.content,
      attachments: metadata?.attachments?.map<UiAttachment>((attachment) => ({ id: attachment.id || newId('attachment'), name: attachment.name, size: attachment.size, mimeType: attachment.mime_type, kind: attachment.kind === 'image' ? 'image' : attachment.kind === 'text' ? 'text' : 'file', status: attachment.error ? 'error' : 'ready', error: attachment.error, dataBase64: attachment.data_base64, textContent: attachment.text_content })) ?? (item.images ?? []).map((image, imageIndex) => restoredImageAttachment(image.image_url, index, imageIndex)),
      references: metadata?.references,
      skills: metadata?.skills?.map((path) => ({ path, name: snapshot.value.skills.find((skill) => skill.path === path || `builtin://${skill.id}` === path)?.name || path })),
      collaborationMode: metadata?.collaboration_mode,
      responseAnnotations: responseAnnotations.length > 0 ? responseAnnotations : undefined,
      modelProfileId: restoredProfileId,
      model: restoredProfile?.model,
      reasoningEffort: item.reasoning_effort || record.reasoning_effort || undefined,
      turnIndex: normalizedTurnIndex,
      turnId: `restored-${normalizedTurnIndex}`,
      sessionMessageIndex: index,
      sessionTurnIndex: normalizedTurnIndex,
      timelineOrder: item.timeline_order,
    }
  })
  // 旧会话通常把批注写在发送它的 user 记录上；恢复时把标记重新挂到对应的
  // 最近一条 assistant 回复，确保右侧编号仍能打开原批注编辑器。
  for (const [index, message] of restored.entries()) {
    if (message.role !== 'user' || !message.responseAnnotations?.length) continue
    const source = [...restored.slice(0, index)].reverse().find((candidate) => candidate.role === 'assistant')
    if (!source) continue
    source.responseAnnotations = [
      ...(source.responseAnnotations ?? []),
      ...message.responseAnnotations
        .filter((annotation) => !(source.responseAnnotations ?? []).some((current) => current.id === annotation.id))
        .map((annotation) => ({
          ...annotation,
          sourceMessageId: source.id,
          sourceTurnIndex: source.turnIndex,
        })),
    ]
  }
  // 工具活动是 JSONL 中独立的 custom entry。按真实行号把它和 user/assistant
  // 消息重新合并；不能再“找到一条 assistant 就把整轮活动放到它前面”。
  const byTurn = new Map<number, UiMessage[]>()
  for (const message of restored) {
    const turn = message.sessionTurnIndex ?? message.turnIndex ?? 0
    const list = byTurn.get(turn) ?? []
    list.push(message)
    byTurn.set(turn, list)
  }
  for (const entry of record.activities ?? []) {
    const activity = eventToMessage(entry.event, entry.turn_index, record.cwd || '', entry.timeline_order)
    const list = byTurn.get(entry.turn_index) ?? []
    // 旧会话可能同时保留同一事件的多个状态；事件 ID 相同的记录只更新内容，
    // 排序位置由第一次出现的 timeline_order 决定。
    const existing = list.findIndex((item) => item.id === activity.id)
    if (existing >= 0) {
      activity.timelineOrder = list[existing].timelineOrder ?? activity.timelineOrder
      list[existing] = activity
    } else {
      list.push(activity)
    }
    byTurn.set(entry.turn_index, list)
  }
  return Array.from(byTurn.keys()).sort((left, right) => left - right).flatMap((turn) => {
    const list = byTurn.get(turn) ?? []
    return list.sort((left, right) => {
      const leftOrder = left.timelineOrder ?? Number.MAX_SAFE_INTEGER
      const rightOrder = right.timelineOrder ?? Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder
    })
  })
}

function messageTurnIndex(message: UiMessage): number {
  if (typeof message.sessionTurnIndex === 'number') return message.sessionTurnIndex
  if (typeof message.turnIndex === 'number' && Number.isFinite(message.turnIndex)) {
    return Math.max(0, Math.trunc(message.turnIndex))
  }
  let userTurns = 0
  for (const candidate of messages.value) {
    if (candidate.id === message.id) {
      return message.role === 'user' ? userTurns : Math.max(0, userTurns - 1)
    }
    if (candidate.role === 'user') userTurns += 1
  }
  return Math.max(0, userTurns - (message.role === 'user' ? 0 : 1))
}

function messageDraftPayload(message: UiMessage): ComposerDraftPayload {
  return {
    text: message.text,
    skills: message.skills?.map((skill) => ({ name: skill.name, path: skill.path })) ?? [],
    attachments: message.attachments?.map(({ previewUrl: _previewUrl, ...attachment }) => ({
      ...attachment,
      status: attachment.status === 'reading' ? 'error' : attachment.status,
    })),
    references: message.references ?? [],
    responseAnnotations: message.responseAnnotations ?? [],
  }
}

function restoreSessionModelSelection(record: SessionRecord): void {
  const profileId = record.model_profile_id
  if (!profileId) return
  const profile = snapshot.value.models.find((model) => model.id === profileId && model.enabled)
  if (!profile) return
  selectedModelProfileId.value = profile.id
  selectedModel.value = profile.model
  reasoningEffort.value = normalizeReasoningEffort(record.reasoning_effort || reasoningEffort.value, profile)
}

function restoreMessageModelSelection(message: UiMessage): void {
  if (!message.modelProfileId) return
  const profile = snapshot.value.models.find((model) => model.id === message.modelProfileId && model.enabled)
  if (!profile) return
  selectedModelProfileId.value = profile.id
  selectedModel.value = profile.model
  reasoningEffort.value = normalizeReasoningEffort(message.reasoningEffort || reasoningEffort.value, profile)
  collaborationMode.value = message.collaborationMode || collaborationMode.value
}

function applyForkedSession(record: SessionRecord): void {
  workspace.create(currentProject.value, record.session_id)
  pendingResponseAnnotations.value = []
  messages.value = restoreSessionMessages(record)
  restoreSessionModelSelection(record)
  workspace.active.value.session = { ...workspace.active.value.session, session_id: record.session_id, session_file: record.path, name: record.name, message_count: record.message_count }
  snapshot.value = {
    ...snapshot.value,
    session: {
      ...snapshot.value.session,
      session_id: record.session_id,
      session_file: record.path,
      name: record.name,
      message_count: record.message_count,
    },
  }
}

async function forkMessageSession(message: UiMessage, mode: 'before_turn' | 'through_turn', name?: string): Promise<SessionRecord | null> {
  if (isBusy.value) {
    showNotice('当前任务仍在运行，请先停止或等待它完成。')
    return null
  }
  const sessionFile = workspace.active.value.session.session_file
  if (!sessionFile) {
    showNotice('这条消息还没有持久化会话，暂时无法创建分支。')
    return null
  }
  try {
    const record = await forkSession({
      path: sessionFile,
      turnIndex: messageTurnIndex(message),
      mode,
      name,
    })
    applyForkedSession(record)
    await refresh()
    return record
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
    return null
  }
}

function showNotice(message: string): void {
  notice.value = message
  window.setTimeout(() => {
    if (notice.value === message) notice.value = ''
  }, 5000)
}

function normalizeReasoningEffort(
  value: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max',
  profile: ModelSummary | null,
): 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  const supported = profile?.reasoning_levels ?? []
  if (supported.includes(value)) return value
  if (supported.includes('medium')) return 'medium'
  return (['high', 'low', 'minimal', 'none', 'xhigh', 'max'] as const).find((level) => supported.includes(level)) ?? 'none'
}

async function refresh(): Promise<void> {
  if (isRefreshing.value) return
  isRefreshing.value = true
  try {
    // 模型连接配置和工作区快照互不依赖，按 Codex 控制面思路并行读取；
    // 之前串行等待会把两个本地 IPC 请求的耗时叠加到模式切换反馈上。
    const [, next] = await Promise.all([modelSettings.reload(), getSnapshot()])
    // MCP 探测期间可能已保存/导入模型。完整快照只合并其他数据，模型以独立
    // 接口为准，避免较晚返回的旧快照把新配置和对话选择器回滚。
    next.models = snapshot.value.models
    next.model = snapshot.value.model
    next.active_model_id = snapshot.value.active_model_id
    snapshot.value = next
    workbenchMode.value = next.workbench_mode
    projectPathDraft.value = next.project.path || ''
    const activeModel = next.models.find((model) => model.id === next.active_model_id && model.enabled)
      ?? next.models.find((model) => model.enabled)
      ?? next.model
    const selectedProfileStillAvailable = next.models.some((model) => model.id === selectedModelProfileId.value && model.enabled)
    const selectedModelStillAvailable = next.models.some((model) => model.model === selectedModel.value && model.enabled)
    if (!selectedModelProfileId.value || (!selectedProfileStillAvailable && !selectedModelStillAvailable)) {
      selectedModelProfileId.value = activeModel.id
      selectedModel.value = activeModel.model
    } else if (!selectedProfileStillAvailable) {
      selectedModelProfileId.value = next.models.find((model) => model.model === selectedModel.value && model.enabled)?.id || activeModel.id
    } else {
      selectedModel.value = next.models.find((model) => model.id === selectedModelProfileId.value)?.model || activeModel.model
    }
    reasoningEffort.value = normalizeReasoningEffort(reasoningEffort.value, selectedModelProfile.value)
    const server = next.mcp_servers[0]
    if (server) {
      mcpForm.value = {
        ...mcpForm.value,
        id: server.id,
        name: server.name,
        command: server.command,
        transport: server.transport === 'http' ? 'http' : 'stdio',
        url: server.url || '',
      }
    }
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '桌面运行时尚未连接')
  } finally {
    isRefreshing.value = false
  }
}

function eventToMessage(event: AgentEvent, turnIndex: number, cwd = currentCwd.value, timelineOrder?: number): UiMessage {
  if (event.kind === 'steering') {
    const input = JSON.parse(event.detail || '{}') as { text?: string; turn_index?: number; references?: UiMentionReference[]; attachments?: Array<{ id: string; name: string; mime_type: string; size: number; kind: UiAttachment['kind']; data_base64?: string; text_content?: string }> }
    return { id: `turn-${turnIndex}:${event.id}`, role: 'user', text: input.text || event.title,
      messageType: 'steering', turnId: `turn-${turnIndex}`, turnIndex, sessionTurnIndex: input.turn_index,
      references: input.references, attachments: input.attachments?.map((item) => ({ id: item.id, name: item.name, mimeType: item.mime_type, size: item.size, kind: item.kind, status: 'ready', dataBase64: item.data_base64, textContent: item.text_content })), timelineOrder,
    }
  }
  if (event.kind === 'progress') return {
    id: `turn-${turnIndex}:${event.id}`, role: 'assistant', text: event.detail || event.title,
    messageType: 'agentMessage.commentary', turnId: `turn-${turnIndex}`, turnIndex, timelineOrder,
  }
  const status = event.status === 'warning' || event.status === 'error' ? 'failed' : event.status === 'done' || event.status === 'approved' ? 'completed' : event.status === 'waiting' ? 'waiting' : event.status === 'blocked' ? 'declined' : 'inProgress'
  const command = event.title || event.tool || event.kind
  return {
    // 后端事件 ID 只保证单轮内稳定（例如 toolCallId）；增加 turn 前缀既能让
    // start/end 原位更新，也不会与下一轮的 agent-run、retry-1 等固定 ID 冲突。
    id: event.id ? `turn-${turnIndex}:${event.id}` : newId('event'),
    role: 'system',
    text: event.detail || event.title,
    messageType: 'commandExecution',
    turnId: `turn-${turnIndex}`,
    turnIndex,
    timelineOrder,
    commandExecution: {
      command,
      tool: event.tool,
      kind: event.kind,
      cwd: cwd || null,
      status,
      aggregatedOutput: event.detail || event.title,
      exitCode: status === 'completed' ? 0 : null,
    },
  }
}

function isVisibleActivityEvent(event: AgentEvent): boolean {
  return ['tool', 'command', 'retry', 'approval', 'safety', 'compaction', 'progress', 'steering'].includes(event.kind)
    || (event.kind === 'mcp' && ['warning', 'error', 'blocked'].includes(event.status))
}

function splitLiveAssistantBeforeActivity(
  event: AgentEvent,
  turnIndex: number,
  thread: WorkspaceThread,
  streamedText: string,
  resetStream: (requestId: string) => void,
  requestId: string,
): void {
  if (!['tool', 'command', 'approval', 'safety', 'progress', 'steering'].includes(event.kind)) return
  const { messages, streamingAssistantId } = workspace.refs(thread)
  const eventId = event.id ? `turn-${turnIndex}:${event.id}` : ''
  if (eventId && messages.value.some((message) => message.id === eventId)) return
  const activeId = streamingAssistantId.value
  if (activeId && streamedText.trim()) {
    messages.value = messages.value.map((message) => message.id === activeId ? { ...message, text: streamedText } : message)
  }
  // 文本流 composable 只有一个当前缓冲。工具/命令后必须清空它，后续 delta
  // 才会进入 upsertLiveAgentEvent 新建的 assistant 段，而不是把前文再写一遍。
  resetStream(requestId)
}

/**
 * 将单次工具生命周期固定在一行中：start 首次插入，update/end 依据同一 ID 原位替换。
 * 新的工具首次出现时插在当前文本段之后，并创建下一段 live assistant；同一
 * toolCallId 的 update/end 只原位替换，因而不会把已经输出的文本重新挪到顶部。
 */
function upsertLiveAgentEvent(event: AgentEvent, turnIndex: number, thread = workspace.active.value, timelineOrder?: number): void {
  const { messages, streamingAssistantId } = workspace.refs(thread)
  if (!isVisibleActivityEvent(event)) return
  const nextMessage = eventToMessage(event, turnIndex, thread.project.project_directory || thread.project.path || '', timelineOrder)
  const next = [...messages.value]
  const existingIndex = next.findIndex((message) => message.id === nextMessage.id)
  if (existingIndex >= 0) {
    // 生命周期更新不能重新计算顺序；保留第一次出现时的时间线位置。
    nextMessage.timelineOrder = next[existingIndex].timelineOrder ?? timelineOrder
    next[existingIndex] = nextMessage
  } else {
    const assistantIndex = next.findIndex((message) => message.id === streamingAssistantId.value)
    const insertIndex = assistantIndex >= 0 ? assistantIndex + 1 : next.length
    nextMessage.timelineOrder = timelineOrder
    next.splice(insertIndex, 0, nextMessage)
    // 工具后续返回的 delta 必须进入新的文本段，否则 watcher 会把文字继续写到
    // 工具之前的 assistant 节点，视觉上就会再次出现“工具在顶部”的错位。
    if (assistantIndex >= 0 && (event.kind === 'tool' || event.kind === 'command' || event.kind === 'approval' || event.kind === 'safety' || event.kind === 'progress' || event.kind === 'steering')) {
      const nextAssistant: UiMessage = {
        id: newId('assistant-live'),
        role: 'assistant',
        text: '',
        messageType: 'agentMessage.live',
        turnId: `turn-${turnIndex}`,
        turnIndex,
        timelineOrder: timelineOrder === undefined ? undefined : timelineOrder + 0.001,
      }
      next.splice(insertIndex + 1, 0, nextAssistant)
      streamingAssistantId.value = nextAssistant.id
    }
  }
  messages.value = next
}

function appendAgentResult(
  result: AgentResult,
  userText: string,
  selectedSkills: Array<{ name: string; path: string }> = [],
  attachments: SubmitPayload['attachments'] = [],
  references: UiMentionReference[] = [],
  responseAnnotations: UiResponseTextAnnotation[] = [],
  activityDurationMs = 0,
  modelProfileId = '',
  modelId = '',
  reasoningEffortId: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' = 'medium',
  collaborationModeId: CollaborationModeKind = 'default',
  thread = workspace.active.value,
  sessionTurnIndex?: number,
): void {
  const { messages, liveOverlay, diagnostics, diagnosticNote } = workspace.refs(thread)
  const queuedMessages = messages.value.filter(isQueuedMessage)
  const currentMessages = messages.value.filter((item) => !isQueuedMessage(item))
  const turnIndex = currentMessages.filter((item) => item.role === 'user').length - 1
  const resultMessages = result.events
    .filter(isVisibleActivityEvent)
    .map((event, index) => eventToMessage(event, turnIndex, thread.project.project_directory || thread.project.path || '', index))
  const resultById = new Map(resultMessages.map((message) => [message.id, message]))
  const finalAssistantIndex = currentMessages.reduce((last, message, index) => message.role === 'assistant' && message.turnIndex === turnIndex ? index : last, -1)
  // 只补上实时监听错过的活动，已存在的工具节点保持原始位置并更新最终状态。
  const missingResultMessages: UiMessage[] = []
  for (const [id, resultMessage] of resultById) {
    const existingIndex = currentMessages.findIndex((message) => message.id === id)
    if (existingIndex >= 0) {
      currentMessages[existingIndex] = { ...currentMessages[existingIndex], ...resultMessage, timelineOrder: currentMessages[existingIndex].timelineOrder ?? resultMessage.timelineOrder }
    } else {
      missingResultMessages.push(resultMessage)
    }
  }
  if (missingResultMessages.length > 0) currentMessages.splice(finalAssistantIndex >= 0 ? finalAssistantIndex : currentMessages.length, 0, ...missingResultMessages)
  const liveMessages = currentMessages.filter((item) => item.messageType === 'agentMessage.live')
  const streamedText = liveMessages.map((item) => item.text).join('')
  const lastLiveId = liveMessages[liveMessages.length - 1]?.id
  for (let index = 0; index < currentMessages.length; index += 1) {
    const item = currentMessages[index]
    if (item.messageType !== 'agentMessage.live') continue
    const text = item.text || (!streamedText.trim() && item.id === lastLiveId && !hasTurnResponseText(currentMessages, turnIndex, result.text) ? result.text : '')
    currentMessages[index] = { ...item, text, messageType: text ? undefined : item.messageType, sessionTurnIndex: sessionTurnIndex ?? null }
  }
  for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
    if (currentMessages[index].messageType === 'agentMessage.live' && !currentMessages[index].text.trim()) currentMessages.splice(index, 1)
  }
  const activityEventIds = resultMessages.filter((message) => message.commandExecution).map((message) => message.id)
  if ((activityEventIds.length > 0 || activityDurationMs > 0) && !currentMessages.some((message) => message.messageType === 'worked' && message.turnId === `turn-${turnIndex}`)) {
    // worked 只承担耗时分隔线。工具节点已经按真实发生位置渲染，不能再把
    // activityEventIds 绑定到 worked，否则 ThreadConversation 会隐藏原工具并
    // 在分隔线处重复展开，重新制造“工具集中在顶部”的问题。
    const workedMessage: UiMessage = { id: newId('worked'), role: 'system', text: '处理完成', messageType: 'worked', activityDurationMs: Math.max(0, Math.round(activityDurationMs)), turnId: `turn-${turnIndex}`, turnIndex }
    const userIndex = currentMessages.findIndex((message) => message.role === 'user' && message.turnIndex === turnIndex)
    const firstTurnIndex = currentMessages.findIndex((message) => message.turnIndex === turnIndex)
    const insertAt = userIndex >= 0 ? userIndex + 1 : firstTurnIndex >= 0 ? firstTurnIndex : currentMessages.length
    currentMessages.splice(insertAt, 0, workedMessage)
  }
  // 发送时已经存在用户消息；只在极端本地命令场景补全用户元数据，禁止重新插入
  // 同一条用户内容，避免结束回调把工具和正文重新排列。
  const userMessage = [...currentMessages].reverse().find((message) => message.role === 'user' && message.turnIndex === turnIndex)
  if (userMessage) Object.assign(userMessage, { skills: selectedSkills.length ? selectedSkills : userMessage.skills, attachments: attachments.length ? attachments : userMessage.attachments, references: references.length ? references : userMessage.references, responseAnnotations: responseAnnotations.length ? responseAnnotations : userMessage.responseAnnotations, modelProfileId: modelProfileId || userMessage.modelProfileId, model: modelId || userMessage.model, reasoningEffort: reasoningEffortId, collaborationMode: collaborationModeId, sessionTurnIndex: sessionTurnIndex ?? userMessage.sessionTurnIndex })
  messages.value = [...currentMessages, ...queuedMessages]
  thread.session = result.session
  thread.pendingChanges = result.pending_changes
  snapshot.value = {
    ...snapshot.value,
    pending_changes: result.pending_changes,
    session: result.session,
  }
  diagnostics.value = result.diagnostics
  diagnosticNote.value = result.diagnostics.length > 0 ? '本轮 Agent 返回了诊断项。' : ''
  liveOverlay.value = null
  if (thread === workspace.active.value && result.pending_changes.some((item) => item.status === 'pending')) activeView.value = 'overview'
}

function readDiagnosticPayload(content: unknown): { diagnostics: Diagnostic[]; note: string } {
  const first = Array.isArray(content) ? content[0] : null
  const text = first && typeof first === 'object' && typeof (first as { text?: unknown }).text === 'string'
    ? (first as { text: string }).text
    : ''
  if (!text) return { diagnostics: [], note: '' }
  try {
    const parsed = JSON.parse(text) as { diagnostics?: unknown; note?: unknown; compiler_executed?: unknown }
    const items = Array.isArray(parsed.diagnostics) ? parsed.diagnostics.filter((item): item is Diagnostic => (
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as Diagnostic).message === 'string'
    )) : []
    const compilerNote = parsed.compiler_executed === false
      ? '未执行 CODESYS 目标编译器，仅完成桌面静态结构诊断。'
      : ''
    return {
      diagnostics: items,
      note: typeof parsed.note === 'string' && parsed.note.trim() ? parsed.note : compilerNote,
    }
  } catch {
    return { diagnostics: [], note: text.slice(0, 240) }
  }
}

function insertFileMention(): void {
  composerRef.value?.appendTextToDraft('@')
}

function queuedMessageFromPayload(id: string, payload: SubmitPayload): UiMessage {
  const attachments = messageAttachments((payload.attachments ?? []).filter((attachment) => attachment.status === 'ready'))
  return {
    id,
    role: 'user',
    text: payload.text.trim(),
    attachments: attachments.length > 0 ? attachments : undefined,
    references: payload.references.length > 0 ? payload.references : undefined,
    responseAnnotations: payload.responseAnnotations.length > 0 ? payload.responseAnnotations : undefined,
    modelProfileId: payload.modelProfileId,
    model: payload.model,
    reasoningEffort: payload.reasoningEffort,
    collaborationMode: payload.collaborationMode,
    messageType: 'queued',
    turnId: `queued-${id}`,
    turnIndex: messages.value.filter((item) => item.role === 'user' && !isQueuedMessage(item)).length,
  }
}

function enqueueSubmit(payload: SubmitPayload, thread = workspace.active.value, first = false): void {
  const { queuedSubmits, messages, selectedModel, selectedModelProfileId, reasoningEffort, collaborationMode } = workspace.refs(thread)
  const id = newId('queued')
  const queuedPayload: SubmitPayload = {
    ...payload,
    modelProfileId: payload.modelProfileId || selectedModelProfileId.value,
    model: payload.model || selectedModel.value,
    reasoningEffort: payload.reasoningEffort || reasoningEffort.value,
    collaborationMode: payload.collaborationMode || collaborationMode.value,
  }
  queuedSubmits.value = first ? [{ id, payload: queuedPayload }, ...queuedSubmits.value] : [...queuedSubmits.value, { id, payload: queuedPayload }]
  showNotice(`已加入队列（前方 ${queuedSubmits.value.length} 条任务）`)
}

async function drainSubmitQueue(thread = workspace.active.value): Promise<void> {
  const { isBusy, isDrainingSubmitQueue, queuedSubmits, messages } = workspace.refs(thread)
  if (thread.queuePaused || isBusy.value || isDrainingSubmitQueue.value || queuedSubmits.value.length === 0) return
  const next = queuedSubmits.value[0]
  if (!next) return
  isDrainingSubmitQueue.value = true
  queuedSubmits.value = queuedSubmits.value.slice(1)
  messages.value = messages.value.filter((message) => message.id !== next.id)
  try {
    await onSubmit(next.payload, thread)
  } finally {
    isDrainingSubmitQueue.value = false
    if (!isBusy.value && queuedSubmits.value.length > 0) void drainSubmitQueue(thread)
  }
}

function cancelQueuedSubmit(id: string): void {
  queuedSubmits.value = queuedSubmits.value.filter((item) => item.id !== id)
  messages.value = messages.value.filter((message) => message.id !== id)
}

function reorderQueuedSubmit(id: string, targetId: string): void {
  const list = [...queuedSubmits.value]
  const index = list.findIndex((item) => item.id === id)
  const target = list.findIndex((item) => item.id === targetId)
  if (index < 0 || target < 0 || list[index].steering || list[target].steering) return
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item)
  queuedSubmits.value = list
}

function withdrawQueuedSubmit(id: string): void {
  const item = queuedSubmits.value.find((item) => item.id === id && !item.steering)
  if (!item || !composerRef.value) return
  const draft = composerRef.value.readDraft()
  const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map((item) => [item.id, item])).values()]
  composerRef.value.hydrateDraft({
    text: [item.payload.text, draft.text].filter(Boolean).join('\n\n'),
    skills: [...new Map([...item.payload.skills, ...draft.skills].map((skill) => [skill.path, skill])).values()],
    attachments: unique([...(item.payload.attachments || []), ...(draft.attachments || [])]),
    references: unique([...(item.payload.references || []), ...(draft.references || [])]),
    responseAnnotations: unique([...(item.payload.responseAnnotations || []), ...(draft.responseAnnotations || [])]),
  })
  cancelQueuedSubmit(id)
}

async function submitSteering(payload: SubmitPayload, thread = workspace.active.value, queuedId?: string): Promise<void> {
  const id = queuedId || newId('steer')
  const item = { id, payload, steering: true }
  thread.queuedSubmits = queuedId ? thread.queuedSubmits.map((entry) => entry.id === id ? item : entry) : [...thread.queuedSubmits, item]
  try {
    await steerAgent(thread.streamingRequestId, thread.id, id, payload)
    showNotice('已提交新方向，当前操作完成后采用。')
  } catch (error) {
    thread.queuedSubmits = thread.queuedSubmits.map((entry) => entry.id === id ? { ...entry, steering: false } : entry)
    showNotice(`${String(error)} 消息已保留在队列中。`)
    if (!thread.isBusy) void drainSubmitQueue(thread)
  }
}

async function steerQueuedSubmit(id: string): Promise<void> {
  const item = queuedSubmits.value.find((item) => item.id === id && !item.steering)
  if (!item) return
  if (isBusy.value) await submitSteering(item.payload, workspace.active.value, id)
  else { cancelQueuedSubmit(id); await onSubmit(item.payload) }
}

function resumeSubmitQueue(): void {
  queuePaused.value = false
  void drainSubmitQueue()
}

async function onSubmit(payload: SubmitPayload, thread = workspace.active.value): Promise<void> {
  const { messages, isBusy, liveOverlay, pendingResponseAnnotations, streamingRequestId, streamingAssistantId, selectedModel, selectedModelProfileId, reasoningEffort, collaborationMode } = workspace.refs(thread)
  const { displayedText: streamingText, currentText: currentStreamingText, start: startTextStream, reset: resetTextStream, append: appendTextDelta, flush: flushTextStream, stop: stopTextStream } = thread.textStream
  const text = payload.text.trim()
  if (text === '/stop') { await onInterrupt(false, thread); return }
  if (text === '/new') { await startNewThread(); return }
  if (text === '/clear' && !thread.isBusy) { workspace.create(thread.project); return }
  if (text === '/model') { settingsCategory.value = 'models'; providerDiscoveryRequest.value += 1; showSettings.value = true; return }
  if (text === '/skills' || text === '/mcp') { settingsCategory.value = text.slice(1); showSettings.value = true; return }
  if (text === '/tools') { activeView.value = 'skills'; showSettings.value = false; return }
  if (/^\/(approve|reject)\s+/u.test(text)) {
    const [action, id] = text.split(/\s+/u)
    const change = thread.pendingChanges.find((change) => change.id === id)
    if (!change) { showNotice('找不到该会话中的待审批动作。'); return }
    if (action === '/approve') await onApprove(change); else await onReject(change)
    return
  }
  const attachments = (payload.attachments ?? []).filter((attachment) => attachment.status === 'ready')
  const responseAnnotations = payload.responseAnnotations ?? []
  const visibleAttachments = messageAttachments(attachments)
  if (!text && attachments.length === 0 && responseAnnotations.length === 0) return
  if (isBusy.value) {
    if (payload.mode === 'steer') await submitSteering(payload, thread)
    else enqueueSubmit(payload, thread)
    return
  }
  isBusy.value = true
  const startedAt = globalThis.performance?.now?.() ?? Date.now()
  const requestId = newId('request')
  streamingRequestId.value = requestId
  startTextStream(requestId)
  liveOverlay.value = {
    activityLabel: '正在处理 PLC 任务',
    activityDetails: ['读取当前工程快照', '按审批边界规划工具调用'],
    reasoningText: '',
    errorText: '',
    status: 'working',
  }
  const queuedMessagesAtStart = messages.value.filter(isQueuedMessage)
  const baseMessages = messages.value.filter((item) => !isQueuedMessage(item))
  const pendingTurnIndex = baseMessages.filter((item) => item.role === 'user').length
  const requestModel = payload.model?.trim() || selectedModel.value
  const requestModelProfileId = payload.modelProfileId?.trim() || selectedModelProfileId.value
  const requestReasoningEffort = payload.reasoningEffort ?? reasoningEffort.value
  const requestCollaborationMode: CollaborationModeKind = /^\/plan(?:\s|$)/iu.test(text)
    ? 'plan'
    : payload.collaborationMode ?? collaborationMode.value
  const pendingUserMessage: UiMessage = {
    id: newId('user'),
    role: 'user',
    text,
    attachments: visibleAttachments.length > 0 ? visibleAttachments : undefined,
    references: payload.references.length > 0 ? payload.references : undefined,
    responseAnnotations: responseAnnotations.length > 0 ? responseAnnotations : undefined,
    modelProfileId: requestModelProfileId,
    model: requestModel,
    reasoningEffort: requestReasoningEffort,
    collaborationMode: requestCollaborationMode,
    turnId: `turn-${pendingTurnIndex}`,
    turnIndex: pendingTurnIndex,
  }
  const streamingAssistantMessage: UiMessage = {
    id: newId('assistant-live'),
    role: 'assistant',
    text: '',
    messageType: 'agentMessage.live',
    turnId: `turn-${pendingTurnIndex}`,
    turnIndex: pendingTurnIndex,
  }
  streamingAssistantId.value = streamingAssistantMessage.id
  const stopWatchingText = watch(streamingText, (text) => {
    messages.value = messages.value.map((message) => message.id === streamingAssistantId.value ? { ...message, text } : message)
  })
  // live assistant 是真实模型增量的承载消息，不是静态占位；首个 delta 到达后立即出现正文。
  messages.value = [...baseMessages, pendingUserMessage, streamingAssistantMessage, ...queuedMessagesAtStart]
  let lastStreamSequence = 0
  let nativeTurnIndex: number | undefined
  let thinkingStartedAt = 0
  let thinkingTimer: number | undefined

  function stopThinkingTimer(): void {
    if (thinkingTimer !== undefined) window.clearInterval(thinkingTimer)
    thinkingTimer = undefined
    thinkingStartedAt = 0
  }

  function showThinkingActivity(): void {
    if (!thinkingStartedAt || streamingRequestId.value !== requestId) return
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - thinkingStartedAt) / 1000))
    liveOverlay.value = {
      activityLabel: '正在思考…',
      activityDetails: elapsedSeconds > 0 ? [`已持续 ${elapsedSeconds} 秒`] : ['正在分析上下文'],
      reasoningText: '',
      errorText: '',
      status: 'working',
    }
  }

  function startThinkingTimer(): void {
    if (!thinkingStartedAt) thinkingStartedAt = Date.now()
    showThinkingActivity()
    if (thinkingTimer === undefined) {
      thinkingTimer = window.setInterval(showThinkingActivity, 1000)
    }
  }

  function showAgentEvent(item: AgentEvent, timelineOrder?: number): void {
    if (item.kind === 'steering') {
      thread.queuedSubmits = thread.queuedSubmits.filter((input) => input.id !== item.id)
      splitLiveAssistantBeforeActivity(item, pendingTurnIndex, thread, currentStreamingText(requestId), resetTextStream, requestId)
      upsertLiveAgentEvent(item, pendingTurnIndex, thread, timelineOrder)
      return
    } else if (item.kind === 'steering_error') {
      thread.queuedSubmits = thread.queuedSubmits.map((input) => input.id === item.id ? { ...input, steering: false } : input)
      showNotice('方向调整尚未采用，消息已保留在发送队列。')
      return
    }
    if (item.kind === 'turn' && item.detail) {
      const metadata = JSON.parse(item.detail) as { turn_index?: number }
      if (typeof metadata.turn_index === 'number' && Number.isInteger(metadata.turn_index)) {
        nativeTurnIndex = metadata.turn_index
        pendingUserMessage.sessionTurnIndex = nativeTurnIndex
        messages.value = messages.value.map((message) => message.turnIndex === pendingTurnIndex ? { ...message, sessionTurnIndex: nativeTurnIndex } : message)
      }
      return
    }
    if (item.kind === 'retry' && item.status === 'running') {
      messages.value = messages.value.map((message) => message.commandExecution?.kind === 'retry' && message.commandExecution.status === 'inProgress' ? { ...message, commandExecution: { ...message.commandExecution, status: 'completed', exitCode: 0 } } : message)
    }
    splitLiveAssistantBeforeActivity(item, pendingTurnIndex, thread, currentStreamingText(requestId), resetTextStream, requestId)
    upsertLiveAgentEvent(item, pendingTurnIndex, thread, timelineOrder)
    if (item.kind === 'progress') {
      // 已落定的中途说明使用独立正文。清理同一段 live 文本，下一次生成再续写，
      // 避免进度说明、工具详情和浮动状态中重复出现同一段文字。
      resetTextStream(requestId)
      return
    }
    if (item.kind === 'retry') {
      stopThinkingTimer()
      if (item.status === 'running' || item.status === 'warning') {
        // 上一次失败流可能已经产生半截文字；重连等待开始时清理该尝试，
        // 下一次 assistant stream_start 会再次确认边界。
        resetTextStream(requestId)
        const attempt = item.retry_attempt ?? 1
        const maxAttempts = item.retry_max_attempts ?? 5
        const wait = item.retry_delay_ms === null || item.retry_delay_ms === undefined
          ? ''
          : ` · ${(item.retry_delay_ms / 1000).toFixed(1)} 秒后重试`
        const statusCode = item.retry_status ? `HTTP ${item.retry_status}` : '连接中断'
        liveOverlay.value = {
          activityLabel: `Reconnecting… 第 ${attempt}/${maxAttempts} 次`,
          activityDetails: [`${statusCode}${wait}`],
          reasoningText: '',
          errorText: '',
          status: 'reconnecting',
        }
      } else if (item.status === 'done') {
        liveOverlay.value = {
          activityLabel: '已重新连接，继续生成…',
          activityDetails: [],
          reasoningText: '',
          errorText: '',
          status: 'working',
        }
      }
      return
    }
    if (item.kind === 'model') {
      if (item.status === 'running') startThinkingTimer()
      else if (streamingText.value) {
        stopThinkingTimer()
        liveOverlay.value = {
          activityLabel: '正在完成回复…',
          activityDetails: [],
          reasoningText: '',
          errorText: '',
          status: 'streaming',
        }
      }
      return
    }
    if (isVisibleActivityEvent(item)) {
      stopThinkingTimer()
      const failed = ['warning', 'error', 'blocked'].includes(item.status)
      liveOverlay.value = {
        activityLabel: item.status === 'running' ? item.title : failed ? '工具返回了诊断' : '工具已完成，正在继续…',
        activityDetails: [],
        reasoningText: '',
        errorText: failed ? item.detail || '' : '',
        status: failed ? 'error' : 'working',
      }
    }
  }

  function onAgentStream(payload: AgentStreamPayload): void {
    if (payload.request_id !== requestId || payload.sequence <= lastStreamSequence) return
    lastStreamSequence = payload.sequence
    if (payload.type === 'session' && payload.session) {
      thread.session = payload.session
      return
    }
    if (payload.type === 'request_start') {
      liveOverlay.value = {
        activityLabel: '正在连接模型…',
        activityDetails: [],
        reasoningText: '',
        errorText: '',
        status: 'working',
      }
      return
    }
    if (payload.type === 'thinking') {
      if (payload.phase === 'end') {
        stopThinkingTimer()
        liveOverlay.value = {
          activityLabel: '正在整理思考结果…',
          activityDetails: [],
          reasoningText: '',
          errorText: '',
          status: 'working',
        }
      } else {
        startThinkingTimer()
      }
      return
    }
    if (payload.type === 'stream_start') {
      stopThinkingTimer()
      resetTextStream(requestId)
      liveOverlay.value = {
        activityLabel: '正在接收模型输出…',
        activityDetails: [],
        reasoningText: '',
        errorText: '',
        status: 'streaming',
      }
      return
    }
    if (payload.type === 'delta' && payload.delta) {
      stopThinkingTimer()
      appendTextDelta(requestId, payload.delta)
      liveOverlay.value = {
        activityLabel: '正在生成回复…',
        activityDetails: [],
        reasoningText: '',
        errorText: '',
        status: 'streaming',
      }
      return
    }
    if (payload.type === 'event' && payload.event) showAgentEvent(payload.event, payload.sequence)
  }

  try {
    // 原先点击新对话或启动应用便创建临时目录，误点也会留下空文件夹。
    // 现在仅在消息通过空内容检查、会话已进入忙碌状态后创建，并固定到
    // 本次发送的 thread；等待期间切换会话不会把目录绑定到另一个线程。
    // 初始化异常复用下方的消息保留和重试流程，后续发送直接复用该目录。
    if (!thread.project.path) {
      thread.project = await startTemporaryWorkspace()
      if (thread === workspace.active.value) {
        snapshot.value = { ...snapshot.value, project: thread.project }
        projectPathDraft.value = thread.project.path || ''
      }
    }
    const history = baseMessages
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .map((item) => ({
        role: item.role,
        content: item.text,
        images: item.attachments
          ?.filter((attachment) => attachment.kind === 'image' && attachment.dataBase64)
          .map((attachment) => ({ image_url: `data:${attachment.mimeType};base64,${attachment.dataBase64}` })),
        references: item.references,
        responseAnnotations: item.responseAnnotations,
      }))
    const agentText = /^\/plan(?:\s|$)/iu.test(text)
      ? text.replace(/^\/plan(?:\s+)?/iu, '').trim() || '请先制定并展示本轮执行计划。'
      : text
    const runOptions: AgentRunOptions = {
      model: requestModel,
      modelProfileId: requestModelProfileId,
      reasoningEffort: requestReasoningEffort,
      collaborationMode: requestCollaborationMode,
      workbenchMode: workbenchMode.value,
      skills: payload.skills,
      attachments,
      references: payload.references,
      responseAnnotations,
      requestId,
      displayMessage: text,
      clientThreadId: thread.id,
      workspacePath: thread.project.path || undefined,
      sessionFile: thread.session.session_file || undefined,
      onEvent: onAgentStream,
    }
    const result = await runAgent(agentText, history, {
      snapshot_id: thread.project.snapshot_id, project_path: thread.project.path,
      project_directory: thread.project.project_directory, working_directory: thread.project.working_directory,
      project_key: thread.project.project_key, active_object: thread.project.active_object, active_file: thread.project.active_file,
    }, runOptions)
    // 等真实 delta 的可见缓冲排空后再换成最终消息，防止 Vue 把连续更新
    // 与最终落地合并成一次绘制，造成“看起来没有流式”的问题。
    await flushTextStream(requestId)
    // 实时列表已经保存了“文本段 → 工具 → 文本段”的真实顺序。这里仅把最后
    // 一个 live assistant 收束为正式回复，并保留原有工具节点，不能再用结果事件
    // 重新从 baseMessages 拼接，否则所有工具都会被挪到正文前面。
    const queuedMessages = messages.value.filter(isQueuedMessage)
    const currentMessages = messages.value.filter((item) => !isQueuedMessage(item))
    const turnMessages = currentMessages.filter((item) => item.turnIndex === pendingTurnIndex)
    const liveIndexes = turnMessages.map((item) => currentMessages.indexOf(item)).filter((index) => index >= 0 && currentMessages[index].messageType === 'agentMessage.live')
    const lastLiveIndex = liveIndexes[liveIndexes.length - 1]
    if (lastLiveIndex !== undefined) {
      const lastLive = currentMessages[lastLiveIndex]
      const finalText = lastLive.text.trim() ? lastLive.text : hasTurnResponseText(currentMessages, pendingTurnIndex, result.text) ? '' : result.text
      currentMessages[lastLiveIndex] = {
        ...lastLive,
        text: finalText,
        messageType: finalText ? undefined : 'agentMessage.live',
        sessionTurnIndex: nativeTurnIndex ?? null,
      }
    } else if (result.text.trim() && !hasTurnResponseText(currentMessages, pendingTurnIndex, result.text)) {
      currentMessages.push({
        id: newId('assistant'), role: 'assistant', text: result.text,
        turnId: `turn-${pendingTurnIndex}`, turnIndex: pendingTurnIndex,
        sessionTurnIndex: nativeTurnIndex ?? null,
      })
    }
    messages.value = [...currentMessages, ...queuedMessages]
    const finishedAt = globalThis.performance?.now?.() ?? Date.now()
    appendAgentResult(result, text, payload.skills, visibleAttachments, payload.references, responseAnnotations, finishedAt - startedAt, requestModelProfileId, requestModel, requestReasoningEffort, requestCollaborationMode, thread, nativeTurnIndex)
    pendingResponseAnnotations.value = []
    // 正文和工具轨迹已经落地，连接检查/MCP 状态刷新不应继续占住发送按钮。
    void refresh().catch(() => undefined)
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error)
    const interrupted = /已中止|已停止/u.test(errorText)
    // 中断或最终错误无需继续播放动画，但要保留已经收到的完整部分回复。
    await flushTextStream(requestId, true)
    const queuedMessages = messages.value.filter(isQueuedMessage)
    const currentMessages = messages.value.filter((item) => !isQueuedMessage(item)).map((item): UiMessage => (
      item.commandExecution?.status === 'inProgress' ? { ...item, commandExecution: { ...item.commandExecution, status: 'interrupted' } } : item
    ))
    const partialText = streamingText.value.trim()
    const livePartialMessages = currentMessages.filter((item) => item.messageType === 'agentMessage.live')
    const streamedPartialText = livePartialMessages.map((item) => item.text).join('')
    const lastPartialId = livePartialMessages[livePartialMessages.length - 1]?.id
    const finalizedPartialMessages = currentMessages.map((item) => {
      if (item.messageType !== 'agentMessage.live') return item
      const text = item.text || (!streamedPartialText.trim() && item.id === lastPartialId ? partialText : '')
      return { ...item, text, messageType: text ? 'assistant.partial' : item.messageType, sessionTurnIndex: nativeTurnIndex ?? null }
    }).filter((item) => item.messageType !== 'agentMessage.live' || item.text.trim())
    messages.value = [
      ...finalizedPartialMessages,
      {
        id: newId('turn-error'),
        role: 'assistant',
        text: interrupted ? '已停止当前任务。' : `这次任务还没有完成：${errorText}`,
        messageType: interrupted ? 'turnInterrupted' : 'turnError',
        sessionTurnIndex: nativeTurnIndex ?? null,
        turnId: `turn-${pendingTurnIndex}`,
        turnIndex: pendingTurnIndex,
        retryPayload: {
          text,
          modelProfileId: requestModelProfileId,
          model: requestModel,
          reasoningEffort: requestReasoningEffort,
          collaborationMode: requestCollaborationMode,
          skills: payload.skills,
          attachments,
          references: payload.references,
          responseAnnotations,
        } satisfies UiRetryPayload,
      },
      ...queuedMessages,
    ]
    // 请求未完成时把批注和原始草稿放回 Composer，确保手动重试不会丢失
    // 所选文本、用户评论及其来源消息绑定。
    pendingResponseAnnotations.value = responseAnnotations
    if (thread === workspace.active.value && !/已中止|已停止/u.test(errorText)) composerRef.value?.hydrateDraft({
      text,
      skills: payload.skills,
      attachments,
      references: payload.references,
      responseAnnotations,
    })
    // Rust/Pi 可能已经创建了包含失败轮次的 JSONL；刷新快照拿到 session_file，
    // 让后续手动重试可以从失败用户消息之前建立干净分支。
    try {
      await refresh()
    } catch {
      // 错误消息已经保留在当前窗口；快照刷新失败不应覆盖可重试入口。
    }
    liveOverlay.value = null
  } finally {
    stopThinkingTimer()
    stopWatchingText()
    isBusy.value = false
    streamingRequestId.value = ''
    streamingAssistantId.value = ''
    stopTextStream(requestId)
    // 轮次边界处来不及被 SDK 消费的调整消息恢复为普通队列，保证输入不丢失。
    thread.queuedSubmits = thread.queuedSubmits.map((item) => ({ ...item, steering: false }))
    if (thread.queuedSubmits.length > 0) void drainSubmitQueue(thread)
  }
}

async function onCompact(): Promise<void> {
  if (isBusy.value) return
  await onSubmit({ text: '/compact', skills: [], attachments: [], references: [], responseAnnotations: [], mode: 'steer' })
}

async function onInterrupt(continueQueue = false, thread = workspace.active.value): Promise<void> {
  const { isBusy } = workspace.refs(thread)
  if (!isBusy.value) return
  try {
    thread.queuePaused = !continueQueue
    thread.liveOverlay = { activityLabel: '正在停止当前任务…', activityDetails: [], reasoningText: '', errorText: '', status: 'working' }
    const result = await abortAgent(thread.streamingRequestId)
    showNotice(result.aborted ? '已请求停止当前 Agent 任务。' : '当前任务已接近完成，无需重复停止。')
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '停止请求尚未送达桌面运行时。')
  }
}

async function onCompile(): Promise<void> {
  try {
    const result = await compileProject()
    const detail = JSON.stringify(result.content, null, 2)
    const parsed = readDiagnosticPayload(result.content)
    diagnostics.value = parsed.diagnostics
    diagnosticNote.value = parsed.note
    messages.value = [...messages.value, eventToMessage({
      id: newId('compile'),
      kind: 'compile',
      title: result.is_error ? '编译返回诊断' : 'CODESYS 编译完成',
      detail,
      status: result.is_error ? 'warning' : 'done',
      tool: 'compile',
    }, messages.value.length)]
    activeView.value = 'overview'
    showNotice(result.is_error ? '编译结果包含诊断，请查看工程概览。' : '编译调用已完成。')
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

function pathKey(value: string | null | undefined): string {
  return normalizePathForUi(value || '').trim().replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase()
}

function isSamePath(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftKey = pathKey(left)
  const rightKey = pathKey(right)
  return leftKey.length > 0 && leftKey === rightKey
}

/**
 * Windows 的 canonicalize/长路径 API 可能返回 `\\?\` 设备路径前缀。
 * 该前缀对文件系统操作有意义，但对用户不可读；这里只转换展示文本，
 * 保留 state 中的原始路径，避免影响项目切换、扫描和长路径访问。
 */
function projectPathLabel(path: string | null | undefined): string {
  return normalizePathForUi(path ?? '')
}

function resetConversationForWorkspace(): void {
  workspace.create(snapshot.value.project)
  messages.value = []
  pendingResponseAnnotations.value = []
  diagnostics.value = []
  diagnosticNote.value = ''
  liveOverlay.value = null
}

async function activateProject(path: string): Promise<void> {
  const normalized = path.trim()
  if (!normalized) {
    showNotice('请输入 CODESYS 工程文件或目录路径。')
    return
  }
  const previousPath = currentProject.value.path
  try {
    const project = await selectProject(normalized)
    snapshot.value = { ...snapshot.value, project }
    const existing = workspace.threads.value.find((thread) => isSamePath(thread.project.path, project.path))
    if (existing) workspace.select(existing)
    else workspace.create(project)
    projectPathDraft.value = project.path || normalized
    if (!isSamePath(previousPath, project.path)) {
      await startNewSession()
    }
    activeView.value = 'chat'
    await refresh()
    showNotice(`已打开工程：${project.name || project.path || normalized}`)
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

async function onSelectProject(): Promise<void> {
  await activateProject(projectPathDraft.value)
}

async function onPickProjectFolder(): Promise<void> {
  try {
    const path = await pickProjectFolder()
    if (path) await activateProject(path)
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '文件夹选择窗口尚未准备好。')
  }
}

async function onOpenProject(project: WorkspaceProject): Promise<void> {
  await activateProject(project.path)
}

async function onRemoveProject(project: WorkspaceProject): Promise<void> {
  if (!await requestConfirm('移除工程', `从工作区移除“${project.name}”吗？不会删除磁盘上的文件。`)) return
  try {
    const projects = await removeProject(project.id)
    snapshot.value = { ...snapshot.value, projects }
    if (isSamePath(currentProject.value.path, project.path)) {
      resetConversationForWorkspace()
      snapshot.value = { ...snapshot.value, project: { ...snapshot.value.project, path: null, exists: false, name: null, project_directory: null, source_root: null, source_files: [], file_count: 0, pou_count: 0, scan_status: 'not_scanned', scan_message: null } }
      activeView.value = 'chat'
    }
    showNotice(`已从工作区移除：${project.name}`)
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

async function onResumeSession(record: SessionRecord): Promise<void> {
  try {
    const existing = workspace.threads.value.find((thread) => thread.session.session_id === record.session_id)
    if (existing) { workspace.select(existing); activeView.value = 'chat'; return }
    if (record.cwd && !isSamePath(currentCwd.value, record.cwd)) {
      const project = await selectProject(record.cwd)
      snapshot.value = { ...snapshot.value, project }
      projectPathDraft.value = project.path || record.cwd
    }
    const resumed = await resumeSession(record.path)
    workspace.create(snapshot.value.project, resumed.session_id)
    workspace.active.value.session = { ...workspace.active.value.session, session_id: resumed.session_id, session_file: resumed.path, name: resumed.name, message_count: resumed.message_count }
    restoreSessionModelSelection(resumed)
    pendingResponseAnnotations.value = []
    messages.value = restoreSessionMessages(resumed)
    snapshot.value = {
      ...snapshot.value,
      session: { ...snapshot.value.session, session_id: resumed.session_id, session_file: resumed.path, name: resumed.name, message_count: resumed.message_count },
    }
    activeView.value = 'chat'
    await refresh()
    showNotice(`已恢复会话：${resumed.name || resumed.session_id.slice(0, 12)}`)
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

async function onEditMessage(message: UiMessage): Promise<void> {
  if (message.role !== 'user') return
  const record = await forkMessageSession(message, 'before_turn')
  if (!record) return
  restoreMessageModelSelection(message)
  await nextTick()
  composerRef.value?.hydrateDraft(messageDraftPayload(message))
  showNotice('已从这条消息前创建编辑分支，请修改后发送。')
}

async function onResendMessage(message: UiMessage): Promise<void> {
  if (message.role !== 'user') return
  const record = await forkMessageSession(message, 'before_turn')
  if (!record) return
  await nextTick()
  const attachments = (message.attachments ?? []).map((attachment) => ({
    ...attachment,
    status: attachment.status === 'reading' ? 'error' : attachment.status,
  }))
  await onSubmit({
    text: message.text,
    model: message.model,
    modelProfileId: message.modelProfileId,
    reasoningEffort: message.reasoningEffort,
    collaborationMode: message.collaborationMode,
    skills: message.skills ?? [],
    attachments,
    references: message.references ?? [],
    responseAnnotations: message.responseAnnotations ?? [],
    mode: 'steer',
  })
}

async function onRetryMessage(message: UiMessage): Promise<void> {
  const retryPayload = message.retryPayload
  if (message.messageType !== 'turnError' || !retryPayload || isBusy.value) return
  const currentProfile = snapshot.value.models.find((model) => model.id === selectedModelProfileId.value && model.enabled)
  if (!currentProfile) {
    showNotice('原模型配置已删除或停用，请先在 Composer 中选择可用模型后重新发送。')
    return
  }
  const retryReasoningEffort = normalizeReasoningEffort(reasoningEffort.value, currentProfile)
  const configurationChanged = currentProfile.id !== retryPayload.modelProfileId || currentProfile.model !== retryPayload.model
    || retryReasoningEffort !== retryPayload.reasoningEffort

  // Pi 已把失败用户轮次写入 JSONL 时，先复制失败轮次之前的内容再重试。
  // 这样重试只会写入一条新的用户消息，不会重复历史或重放已完成工具。
  if (workspace.active.value.session.session_file && message.sessionTurnIndex !== null) {
    const forked = await forkMessageSession(message, 'before_turn', '重试本轮')
    if (!forked) return
  } else {
    messages.value = messages.value.filter((item) => (
      item.turnId !== message.turnId || isQueuedMessage(item)
    ))
  }

  selectedModelProfileId.value = currentProfile.id
  selectedModel.value = currentProfile.model
  reasoningEffort.value = retryReasoningEffort
  showNotice(configurationChanged
    ? `模型配置已更新，改用 ${currentProfile.model} / 思考 ${retryReasoningEffort} 重试本轮。`
    : `正在使用 ${currentProfile.model} / 思考 ${retryReasoningEffort} 重试本轮。`)
  await onSubmit({
    text: retryPayload.text,
    skills: retryPayload.skills,
    attachments: retryPayload.attachments,
    references: retryPayload.references,
    responseAnnotations: retryPayload.responseAnnotations,
    model: currentProfile.model,
    modelProfileId: currentProfile.id,
    reasoningEffort: retryReasoningEffort,
    collaborationMode: retryPayload.collaborationMode,
    mode: 'steer',
  })
}

async function onForkMessage(message: UiMessage): Promise<void> {
  if (message.role !== 'assistant') return
  const record = await forkMessageSession(message, 'through_turn', '从回复分支')
  if (record) showNotice('已创建回复分支，会话历史已保留到这条回复。')
}

function onEditResponseAnnotation(annotation: UiResponseTextAnnotation): void {
  conversationRef.value?.openResponseAnnotation({ ...annotation })
}

function addResponseAnnotation(annotation: UiResponseTextAnnotation): void {
  const source = findMessageForAnnotation(annotation)
  const normalized = source ? { ...annotation, sourceMessageId: source.id } : annotation
  pendingResponseAnnotations.value = [
    ...pendingResponseAnnotations.value.filter((item) => item.id !== normalized.id),
    normalized,
  ]
  messages.value = messages.value.map((message) => message.id === normalized.sourceMessageId
    ? {
        ...message,
        responseAnnotations: [
          ...(message.responseAnnotations ?? []).filter((item) => item.id !== normalized.id),
          normalized,
        ],
      }
    : message)
}

function updateResponseAnnotation(annotation: UiResponseTextAnnotation): void {
  const source = findMessageForAnnotation(annotation)
  const normalized = source ? { ...annotation, sourceMessageId: source.id } : annotation
  const isPending = pendingResponseAnnotations.value.some((item) => item.id === normalized.id)
  pendingResponseAnnotations.value = isPending
    ? pendingResponseAnnotations.value.map((item) => item.id === normalized.id ? normalized : item)
    : [...pendingResponseAnnotations.value, normalized]
  messages.value = messages.value.map((message) => message.id === normalized.sourceMessageId
    ? {
        ...message,
        responseAnnotations: (message.responseAnnotations ?? []).map((item) => item.id === normalized.id ? normalized : item),
      }
    : message)
}

function findMessageForAnnotation(annotation: UiResponseTextAnnotation): UiMessage | undefined {
  return messages.value.find((message) => message.id === annotation.sourceMessageId)
    ?? (annotation.sourceMessageKey
      ? messages.value.find((message) => message.role === 'assistant' && messageStableKeyForApp(message) === annotation.sourceMessageKey)
      : undefined)
    ?? (typeof annotation.sourceTurnIndex === 'number'
      ? [...messages.value].reverse().find((message) => message.role === 'assistant' && message.turnIndex === annotation.sourceTurnIndex)
      : undefined)
    ?? messages.value.find((message) => message.responseAnnotations?.some((item) => item.id === annotation.id))
}

function messageStableKeyForApp(message: UiMessage): string {
  const signature = `${message.role}|${message.turnIndex ?? ''}|${message.text.trim()}`
  let hash = 2166136261
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const occurrence = messages.value
    .slice(0, Math.max(0, messages.value.indexOf(message)) + 1)
    .filter((candidate) => `${candidate.role}|${candidate.turnIndex ?? ''}|${candidate.text.trim()}` === signature)
    .length
  return `${message.role}:${message.turnIndex ?? ''}:${(hash >>> 0).toString(16)}:${occurrence}`
}

function removeResponseAnnotation(id: string): void {
  pendingResponseAnnotations.value = pendingResponseAnnotations.value.filter((item) => item.id !== id)
  messages.value = messages.value.map((message) => {
    if (!message.responseAnnotations?.some((item) => item.id === id)) return message
    const responseAnnotations = message.responseAnnotations.filter((item) => item.id !== id)
    return { ...message, responseAnnotations: responseAnnotations.length > 0 ? responseAnnotations : undefined }
  })
}

async function onRenameSession(record: SessionRecord): Promise<void> {
  const currentName = record.name || ''
  const name = await requestPrompt('重命名会话', '输入新的会话名称', currentName)
  if (name === null || !name.trim()) return
  try {
    await renameSession(name, record.path)
    const local = workspace.threads.value.find((thread) => thread.session.session_id === record.session_id)
    if (local) local.session = { ...local.session, name: name.trim() }
    await refresh()
    showNotice('会话名称已更新。')
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

async function onDeleteSession(record: SessionRecord): Promise<void> {
  if (!await requestConfirm('清理会话', `清理会话“${record.name || record.session_id.slice(0, 12)}”吗？这只会删除本地会话记录。`)) return
  try {
    const sessions = await deleteSession(record.path)
    snapshot.value = { ...snapshot.value, sessions }
    for (const thread of workspace.threads.value.filter((thread) => thread.session.session_id === record.session_id)) workspace.remove(thread)
    showNotice('本地会话记录已清理。')
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

async function onApprove(change: PendingChange): Promise<void> {
  const thread = workspace.active.value
  if (thread.isBusy) { showNotice('请等待该会话结束或停止当前任务后再审批。'); return }
  thread.isBusy = true
  thread.streamingRequestId = `approval-${change.id}`
  try {
    const turnIndex = Math.max(0, thread.messages.filter((message) => message.role === 'user').length - 1)
    const result = await approveChange(change.id, (event) => upsertLiveAgentEvent(event, turnIndex, thread))
    thread.pendingChanges = thread.pendingChanges.filter((pending) => pending.id !== change.id)
    if (change.tool_name !== 'exec_command') thread.messages = [...thread.messages, eventToMessage({ id: change.id, kind: 'tool', title: result.is_error ? '动作返回诊断' : '已完成审批动作', detail: JSON.stringify(result.content, null, 2), status: result.is_error ? 'error' : 'done', tool: change.tool_name }, turnIndex, thread.project.project_directory || thread.project.path || '')]
    showNotice(result.is_error ? '动作返回诊断，请查看工具详情。' : '审批动作已执行。')
    await refresh()
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  } finally {
    thread.isBusy = false
    thread.streamingRequestId = ''
    thread.liveOverlay = null
  }
}

async function onReject(change: PendingChange): Promise<void> {
  try {
    await rejectChange(change.id)
    workspace.active.value.pendingChanges = workspace.active.value.pendingChanges.filter((pending) => pending.id !== change.id)
    showNotice('已拒绝这次工程修改。')
    await refresh()
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

async function onSaveModel(form: ModelForm): Promise<void> {
  if (isSavingModel.value) return
  isSavingModel.value = true
  try {
    const summary = await saveModel(form)
    await modelSettings.reload()
    selectedModelProfileId.value = summary.id
    selectedModel.value = summary.model
    reasoningEffort.value = normalizeReasoningEffort(reasoningEffort.value, summary)
    showNotice(`模型“${summary.name}”已保存到本机配置。`)
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  } finally { isSavingModel.value = false }
}

async function onProvidersChanged(): Promise<void> {
  await modelSettings.reload()
  // 服务商停用后，快照虽然排除了其模型，工作区仍可能保存旧 profile ID。
  // 同步本轮选择，避免按钮显示备用模型但发送时仍请求已停用的服务商。
  if (!snapshot.value.models.some(model => model.id === selectedModelProfileId.value && model.enabled)) {
    const model = snapshot.value.models.find(model => model.id === snapshot.value.active_model_id && model.enabled)
      ?? snapshot.value.models.find(model => model.enabled)
    selectedModelProfileId.value = model?.id ?? ''
    selectedModel.value = model?.model ?? ''
    if (model) reasoningEffort.value = normalizeReasoningEffort(reasoningEffort.value, model)
  }
}

async function onSetActiveModel(id: string): Promise<void> {
  try {
    const summary = await setActiveModel(id)
    selectedModelProfileId.value = summary.id
    selectedModel.value = summary.model
    reasoningEffort.value = normalizeReasoningEffort(reasoningEffort.value, summary)
    await refresh()
    showNotice(`当前模型已切换为“${summary.name}”。`)
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

async function onToggleModel(id: string, enabled: boolean): Promise<void> {
  try {
    await setModelEnabled(id, enabled)
    await refresh()
    showNotice(enabled ? '模型已启用。' : '模型已停用。')
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

async function onDuplicateModel(id: string): Promise<void> {
  try {
    const summary = await duplicateModel(id)
    await refresh()
    selectedModelProfileId.value = summary.id
    selectedModel.value = summary.model
    showNotice(`已复制模型“${summary.name}”。`)
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

async function onDeleteModel(id: string): Promise<void> {
  const target = snapshot.value.models.find((model) => model.id === id)
  if (!target || !await requestConfirm('删除模型', `删除模型配置“${target.name}”吗？服务商连接配置和聊天记录会保留。`)) return
  try {
    await deleteModel(id)
    await refresh()
    showNotice('模型配置已删除。')
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

function onComposerModelChange(profileId: string): void {
  const profile = snapshot.value.models.find((model) => model.enabled && model.id === profileId)
  if (profile) {
    selectedModelProfileId.value = profile.id
    selectedModel.value = profile.model
    reasoningEffort.value = normalizeReasoningEffort(reasoningEffort.value, profile)
  }
}

async function onSaveMcp(): Promise<void> {
  try {
    snapshot.value = { ...snapshot.value, mcp_servers: await saveMcp(mcpForm.value) }
    showNotice('MCP 配置已保存，连接状态以实际探测结果为准。')
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

async function onOpenSkill(skillId: string): Promise<void> {
  try {
    selectedSkillId.value = skillId
    selectedSkillContent.value = await getSkillContent(skillId)
    showSkillDetail.value = true
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

function chooseCommand(command: string, supportsArgs: boolean): void {
  showCommandPalette.value = false
  const payload: ComposerDraftPayload = {
    text: supportsArgs ? `${command} ` : command,
    skills: [],
    responseAnnotations: [],
  }
  composerRef.value?.hydrateDraft(payload)
  if (!supportsArgs) void onSubmit({ text: command, skills: [], attachments: [], references: [], responseAnnotations: [], mode: 'steer' })
}

async function startNewThread(project?: WorkspaceProject): Promise<void> {
  try {
    // 点击新对话只建立内存中的空白线程；临时工作目录由首条真实消息触发，
    // 这样习惯性点击新对话不会在文档目录留下空的日期/时间文件夹。
    const context = project ? await selectProject(project.path) : { ...EMPTY_SNAPSHOT.project }
    workspace.create(context)
    showSettings.value = false
    snapshot.value = { ...snapshot.value, project: context }
    projectPathDraft.value = context.path || ''
    if (project) await refresh()
    activeView.value = 'chat'
    showNotice('已新建会话，工程文件没有改动。')
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

function droppedProjectPath(paths: string[]): string | null {
  const normalized = paths.map((path) => path.trim()).filter(Boolean)
  return normalized.find((path) => /\.(project|projectarchive)$/iu.test(path))
    || normalized.find((path) => !/[.][^\\/]+$/u.test(path))
    || (normalized.length === 1 ? normalized[0] : null)
}

function dropIsOverComposer(position?: { x: number; y: number }): boolean {
  if (!position || typeof document === 'undefined') return false
  const scale = window.devicePixelRatio || 1
  const points = [
    [position.x, position.y],
    [position.x / scale, position.y / scale],
  ]
  return points.some(([x, y]) => document.elementFromPoint(x, y)?.closest('.plc-thread-composer') !== null)
}

async function openDroppedProject(paths: string[], position?: { x: number; y: number }): Promise<void> {
  isWindowDropActive.value = false
  if (dropIsOverComposer(position)) return
  const path = droppedProjectPath(paths)
  if (!path) {
    showNotice('请拖入 CODESYS 工程目录或 .project 文件。')
    return
  }
  await activateProject(path)
}

function onWindowDragOver(event: DragEvent): void {
  if (event.target instanceof Element && event.target.closest('.plc-thread-composer')) {
    isWindowDropActive.value = false
    return
  }
  const types = Array.from(event.dataTransfer?.types ?? [])
  if (!types.includes('Files') && !types.includes('text/uri-list')) return
  event.preventDefault()
  isWindowDropActive.value = true
}

function onWindowDragLeave(event: DragEvent): void {
  if (event.relatedTarget instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
  isWindowDropActive.value = false
}

function uriToLocalPath(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return null
    const pathname = decodeURIComponent(url.pathname)
    if (url.hostname && url.hostname !== 'localhost') return `\\\\${url.hostname}${pathname.replaceAll('/', '\\')}`
    return pathname.replace(/^\/(?=[A-Z]:[\\/])/iu, '')
  } catch {
    return null
  }
}

async function onWindowDrop(event: DragEvent): Promise<void> {
  if (event.target instanceof Element && event.target.closest('.plc-thread-composer')) {
    isWindowDropActive.value = false
    return
  }
  const uriPaths = (event.dataTransfer?.getData('text/uri-list') ?? '')
    .split(/\r?\n/u)
    .map((value) => uriToLocalPath(value.trim()))
    .filter((value): value is string => value !== null)
  if (uriPaths.length === 0) return
  event.preventDefault()
  await openDroppedProject(uriPaths)
}

async function setupNativeWindowDrop(): Promise<void> {
  try {
    stopWindowDrop = await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        isWindowDropActive.value = !dropIsOverComposer(event.payload.position)
        return
      }
      if (event.payload.type === 'leave') {
        isWindowDropActive.value = false
        return
      }
      void openDroppedProject(event.payload.paths, event.payload.position)
    })
  } catch {
    // 浏览器预览没有 Tauri 原生拖拽事件，保留 DOM URI 回退。
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    showCommandPalette.value = !showCommandPalette.value
  }
  if (event.key === 'Escape') {
    showCommandPalette.value = false
    showSettings.value = false
    showSkillDetail.value = false
  }
}

let stopWindowDrop: (() => void) | undefined
let syncTimer: number | undefined

onMounted(async () => {
  // refresh 已并行读取模型配置和界面快照；启动阶段不再重复请求一次模型设置。
  await refresh()
  try {
    const restored = await workspace.restore()
    if (!restored) workspace.active.value.project = snapshot.value.project
    // 空白会话或未发送草稿在重启后继续保持无路径，首次发送再创建目录。
    if (workspace.active.value.project.path) await selectProject(workspace.active.value.project.path)
    await refresh()
    // refresh 读取的是桌面运行时的全局工程；恢复空白临时线程时应继续以
    // 当前线程上下文为准，不能因为启动刷新把它误替换成旧工程。
    snapshot.value = { ...snapshot.value, project: workspace.active.value.project }
    projectPathDraft.value = workspace.active.value.project.path || ''
  } catch (error) { showNotice(`恢复会话工作区未完成：${String(error)}`) }
  window.addEventListener('keydown', onKeyDown)
  await setupNativeWindowDrop()
  syncTimer = window.setInterval(() => {
    void syncCurrentProject().then((project) => {
      if (!workspace.active.value.isBusy && isSamePath(project.path, currentProject.value.path)) {
        workspace.active.value.project = project
        projectPathDraft.value = project.path || projectPathDraft.value
      }
    }).catch(() => undefined)
  }, 4000)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  stopWindowDrop?.()
  if (syncTimer) window.clearInterval(syncTimer)
})
</script>

<template>
  <AppUpdateNotice v-if="!showSettings && updater.state.available && updater.state.phase === 'available' && updater.state.dismissedVersion !== updater.state.available.version"
    :version="updater.state.available.version" @open="settingsCategory = 'updates'; showSettings = true" @dismiss="updater.state.dismissedVersion = updater.state.available!.version" />
  <DesktopLayout
    :is-sidebar-collapsed="isSidebarCollapsed"
    :is-settings-mode="showSettings"
    @close-sidebar="isSidebarCollapsed = true"
    @dragover="onWindowDragOver"
    @dragleave="onWindowDragLeave"
    @drop="onWindowDrop"
  >
    <template #sidebar>
      <WorkspaceSidebar :projects="sidebarProjects" :threads="sidebarThreads" :active-id="activeThreadId" :theme="theme" :workbench-mode="workbenchMode" @update:theme="theme = $event" @update:workbench-mode="onWorkbenchModeChange"
        @new-thread="startNewThread" @select-thread="selectSidebarThread" @open-project="onOpenProject"
        @add-project="onPickProjectFolder" @remove-project="onRemoveProject" @rename-thread="renameSidebarThread" @delete-thread="deleteSidebarThread"
        @open-settings="showSettings = true" @open-skills="activeView = 'skills'; showSettings = false" @open-overview="activeView = 'overview'; showSettings = false" />
    </template>

    <template #topbar>
      <WindowTitleBar
        :title="currentTitle"
        :show-sidebar-toggle="!showSettings"
        :is-sidebar-collapsed="isSidebarCollapsed"
        @toggle-sidebar="isSidebarCollapsed = !isSidebarCollapsed"
        @open-chat="activeView = 'chat'"
        @start-new-thread="startNewThread"
        @open-project="onPickProjectFolder"
        @open-command-palette="showCommandPalette = true"
        @open-skills="activeView = 'skills'"
        @open-settings="showSettings = true"
        @window-error="showNotice"
        @open-about="showAbout = true"
        @open-reward="showReward = true"
        @open-github="openGithubRepository"
        @check-updates="settingsCategory = 'updates'; showSettings = true; updater.check()"
      />
    </template>

    <template #header>
      <ContentHeader :title="showSettings ? '设置' : currentTitle" :accent="activeView !== 'chat'">
        <template #leading>
          <span class="plc-header-status" :data-state="isBusy ? 'busy' : currentProject.exists ? 'ok' : 'idle'" />
        </template>
        <template #actions>
          <button class="plc-header-action" type="button" title="命令面板" aria-label="命令面板" @click="showCommandPalette = true">⌘K</button>
        </template>
      </ContentHeader>
    </template>

    <template #content>
      <SettingsPage v-if="showSettings" v-model:category="settingsCategory" :snapshot="snapshot" :theme="theme" :access-mode="accessMode" :access-mode-disabled="!accessModeReady || accessModeSaving || tasksRunning" @update:access-mode="onAccessModeChange" @close="showSettings = false" @refresh="refresh" @update:theme="theme = $event" @notice="showNotice">
        <template #updates><UpdatesSettingsPanel :state="updater.state" :busy="updater.active.value" :tasks-running="tasksRunning" @check="updater.check" @install="updater.install" @auto-check="updater.setAutoCheck" /></template>
        <template #models>
          <p v-if="!modelSettings.loaded.value || modelSettings.error.value" class="plc-model-loading" role="status">
            {{ modelSettings.error.value || '正在读取本机模型配置…' }}
            <button v-if="modelSettings.error.value" type="button" @click="modelSettings.reload()">重新读取</button>
          </p>
          <ModelSettingsPanel v-if="modelSettings.loaded.value" :models="snapshot.models" :active-model-id="snapshot.active_model_id" :selected-model-id="selectedModelProfileId" :is-saving="isSavingModel"
            :discovery-request="providerDiscoveryRequest" @discovery-handled="providerDiscoveryRequest = 0"
            :current-context-tokens="workspace.active.value.session.context_tokens" :remaining-context-percent="tokenUsage?.remainingContextPercent ?? null" :auto-compaction-enabled="workspace.active.value.session.auto_compaction_enabled"
            @save="onSaveModel" @refresh="onProvidersChanged" @set-active="onSetActiveModel" @toggle-enabled="onToggleModel" @duplicate="onDuplicateModel" @remove="onDeleteModel" />
        </template>
      </SettingsPage>
      <section v-else class="content-root plc-content">
        <div v-if="activeView === 'chat'" class="plc-chat-layout">
          <ThreadConversation
            ref="conversationRef"
            class="plc-conversation"
            :messages="messages"
            :live-overlay="liveOverlay"
            :is-loading="isBusy && messages.length === 0"
            :is-turn-in-progress="isBusy"
            :active-thread-id="activeThreadId"
            :cwd="currentCwd"
            @edit-message="onEditMessage"
            @resend-message="onResendMessage"
            @retry-message="onRetryMessage"
            @fork-message="onForkMessage"
            @notice="showNotice"
            @add-response-annotation="addResponseAnnotation"
            @update-response-annotation="updateResponseAnnotation"
            @remove-response-annotation="removeResponseAnnotation"
          />

          <section v-if="pendingChanges.length > 0" class="plc-approval-strip" aria-live="polite">
            <div class="plc-approval-heading"><span class="plc-approval-dot" />需要审批的工程修改 <span>{{ pendingChanges.length }}</span></div>
            <article v-for="change in pendingChanges" :key="change.id" class="plc-approval-card">
              <div class="plc-approval-copy"><strong>{{ change.title }}</strong><small>{{ change.description }}</small><code>{{ change.id }}</code></div>
              <details class="plc-approval-diff"><summary>查看 Diff</summary><pre>{{ change.diff }}</pre></details>
              <div class="plc-approval-actions"><button type="button" class="plc-button plc-button-quiet" @click="onReject(change)">拒绝</button><button type="button" class="plc-button plc-button-primary" @click="onApprove(change)">批准并写入</button></div>
            </article>
          </section>

        </div>

        <div v-else-if="activeView === 'overview'" class="plc-detail-layout">
          <section class="plc-detail-section plc-project-overview">
            <div class="plc-section-heading"><div><p class="plc-eyebrow">工程上下文</p><h2>{{ currentProject.name || '选择 CODESYS 工程' }}</h2></div><button class="plc-button plc-button-primary" type="button" @click="onCompile"><IconTablerTerminal /> 编译诊断</button></div>
            <div class="plc-project-picker"><input v-model="projectPathDraft" type="text" placeholder="C:\\Projects\\Machine\\Machine.project" @keydown.enter="onSelectProject" /><button class="plc-button plc-button-quiet" type="button" @click="onSelectProject">读取工程</button><button class="plc-button plc-button-quiet plc-project-folder-button" type="button" aria-label="选择工程文件夹" title="选择工程文件夹" @click="onPickProjectFolder"><IconTablerFolder /></button></div>
            <div class="plc-fact-grid"><div><span>版本</span><strong>{{ currentProject.version || snapshot.codesys.supported_version }}</strong></div><div><span>源文件</span><strong>{{ currentProject.file_count }}</strong></div><div><span>POU / 源对象</span><strong>{{ currentProject.pou_count }}</strong></div><div><span>扫描</span><strong :data-state="currentProject.scan_status">{{ currentProject.scan_status === 'scanned' ? '已完成' : currentProject.scan_status === 'warning' ? '需注意' : '等待' }}</strong></div></div>
            <p v-if="currentProject.scan_message" class="plc-inline-note">{{ currentProject.scan_message }}</p>
          </section>
          <section class="plc-detail-section"><div class="plc-section-heading"><div><p class="plc-eyebrow">源对象</p><h2>工程文件</h2></div><button class="plc-link-button" type="button" @click="activeView = 'chat'; insertFileMention()">在对话中引用</button></div><ul class="plc-file-list"><li v-for="file in currentProject.source_files.slice(0, 80)" :key="file"><code>{{ file }}</code></li><li v-if="currentProject.source_files.length === 0" class="plc-empty-row">尚未扫描到可读源文件。</li></ul></section>
          <section v-if="diagnostics.length > 0 || diagnosticNote" class="plc-detail-section plc-diagnostics-section"><div class="plc-section-heading"><div><p class="plc-eyebrow">诊断闭环</p><h2>编译与静态检查</h2></div><span class="plc-section-meta">{{ diagnostics.length }} 项</span></div><p v-if="diagnosticNote" class="plc-inline-note">{{ diagnosticNote }}</p><ul class="plc-diagnostic-list"><li v-for="(item, index) in diagnostics" :key="`${item.location || 'diagnostic'}-${index}`" :data-severity="item.severity"><span>{{ item.severity === 'error' ? '错误' : item.severity === 'warning' ? '警告' : '提示' }}</span><div><strong>{{ item.message }}</strong><small v-if="item.location || item.code">{{ item.location || '工程级' }}<template v-if="item.code"> · {{ item.code }}</template></small></div></li></ul></section>
          <section v-if="snapshot.tools.length > 0" class="plc-detail-section"><div class="plc-section-heading"><div><p class="plc-eyebrow">工具协议</p><h2>MCP 工具</h2></div></div><ul class="plc-tool-list"><li v-for="tool in snapshot.tools" :key="tool.qualified_name"><span :data-mutating="tool.mutating">{{ tool.mutating ? '审批' : '读取' }}</span><code>{{ tool.qualified_name }}</code><small>{{ tool.description || '未提供描述' }}</small></li></ul></section>
        </div>

        <div v-else class="plc-detail-layout">
          <section class="plc-detail-section"><div class="plc-section-heading"><div><p class="plc-eyebrow">内置能力</p><h2>PLC Skills</h2></div><span class="plc-section-meta">{{ snapshot.skills.length }} 项</span></div><div class="plc-skill-grid"><button v-for="skill in snapshot.skills" :key="skill.id" class="plc-skill-card" type="button" @click="onOpenSkill(skill.id)"><span class="plc-skill-badge"><IconTablerBolt /></span><span><strong>{{ skill.name }}</strong><small>{{ skill.description }}</small></span><span class="plc-skill-arrow">→</span></button></div></section>
          <CodesysStatusPanel :codesys="snapshot.codesys" :project="currentProject" />
          <section class="plc-detail-section plc-safety-note"><p class="plc-eyebrow">默认安全边界</p><h2>先读、再预览、审批后写入</h2><p>工程读取、ST 分析、编译和诊断可以自动进行；修改、删除和命令执行需要审批，PLC 下载和在线控制保持阻止。</p></section>
        </div>
      </section>
    </template>

    <template #composer>
      <ComposerQueue v-if="!showSettings && activeView === 'chat' && queuedSubmits.length" :items="queuedSubmits" :paused="queuePaused" :busy="isBusy" @cancel="cancelQueuedSubmit" @resume="resumeSubmitQueue" @edit="withdrawQueuedSubmit" @steer="steerQueuedSubmit" @reorder="reorderQueuedSubmit" />
      <ThreadComposer
        v-if="!showSettings && activeView === 'chat'"
        ref="composerRef"
        class="plc-composer"
        :active-thread-id="activeThreadId"
        :cwd="currentCwd"
        :collaboration-modes="[{ value: 'default', label: '执行' }, { value: 'plan', label: '计划' }]"
        :selected-collaboration-mode="collaborationMode"
        :models="modelOptions"
        :selected-model="selectedModelProfileId"
        :selected-reasoning-effort="reasoningEffort"
        :reasoning-efforts="selectedReasoningEfforts"
        :commands="commands"
        :skills="skills"
        :thread-token-usage="tokenUsage"
        :is-turn-in-progress="isBusy"
        :access-mode="accessMode"
        :access-mode-disabled="!accessModeReady || accessModeSaving || tasksRunning"
        :disabled="false"
        :send-with-enter="true"
        :in-progress-submit-mode="'queue'"
        :response-annotations="pendingResponseAnnotations"
        @submit="onSubmit"
        @interrupt="onInterrupt"
        @update:access-mode="onAccessModeChange"
        @update:selected-collaboration-mode="collaborationMode = $event"
        @update:selected-model="onComposerModelChange"
        @update:selected-reasoning-effort="reasoningEffort = $event || 'none'"
        @update:response-annotations="pendingResponseAnnotations = $event"
        @edit-response-annotation="onEditResponseAnnotation"
        @remove-response-annotation="removeResponseAnnotation"
      />
    </template>
    <template #overlays>
      <div v-if="isWindowDropActive" class="plc-window-drop-overlay" role="status" aria-live="polite">
        <IconTablerFolder />
        <strong>松开以打开工程</strong>
        <span>支持工程目录或 .project 文件</span>
      </div>

      <Transition name="plc-fade"><div v-if="notice" class="plc-toast" role="status">{{ notice }}</div></Transition>

      <div v-if="showCommandPalette" class="plc-overlay" @click.self="showCommandPalette = false">
        <section class="plc-command-palette" role="dialog" aria-modal="true" aria-label="命令面板">
          <div class="plc-modal-heading"><div><p class="plc-eyebrow">快捷入口</p><h2>命令面板</h2></div><button class="plc-close-button" type="button" @click="showCommandPalette = false"><IconTablerX /></button></div>
          <button v-for="item in commands" :key="item.command" class="plc-command-row" type="button" @click="chooseCommand(item.command, item.supports_args)"><code>{{ item.command }}</code><span><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></span><kbd>↵</kbd></button>
        </section>
      </div>
      <div v-if="showAbout || showReward" class="plc-overlay" @click.self="showAbout = showReward = false">
        <section class="plc-info-dialog" role="dialog" aria-modal="true" :aria-label="showAbout ? '关于作者' : '打赏作者'">
          <div class="plc-modal-heading"><div><p class="plc-eyebrow">PLC Pilot</p><h2>{{ showAbout ? '关于作者' : '打赏作者' }}</h2></div><button class="plc-close-button" type="button" aria-label="关闭" @click="showAbout = showReward = false"><IconTablerX /></button></div>
          <p v-if="showAbout" class="plc-info-dialog-copy">作者：蔡徐坤</p>
          <template v-else><p class="plc-info-dialog-copy">感谢支持 PLC Pilot。打赏入口待配置。</p><div class="plc-reward-placeholder" aria-label="打赏二维码占位">打赏二维码待配置</div></template>
        </section>
      </div>
      <div v-if="appDialog" class="plc-overlay plc-dialog-overlay" @click.self="closeAppDialog(appDialog.kind === 'confirm' ? false : null)">
        <section class="plc-info-dialog plc-app-dialog" role="alertdialog" aria-modal="true" :aria-label="appDialog.title">
          <div class="plc-modal-heading"><div><p class="plc-eyebrow">PLC Pilot</p><h2>{{ appDialog.title }}</h2></div><button class="plc-close-button" type="button" aria-label="关闭" @click="closeAppDialog(appDialog.kind === 'confirm' ? false : null)"><IconTablerX /></button></div>
          <p class="plc-info-dialog-copy">{{ appDialog.message }}</p>
          <input v-if="appDialog.kind === 'prompt'" v-model="appDialog.value" class="plc-app-dialog-input" autofocus @keydown.enter="closeAppDialog(appDialog.value)" @keydown.esc="closeAppDialog(null)" />
          <div class="plc-app-dialog-actions"><button class="plc-button plc-button-quiet" type="button" @click="closeAppDialog(appDialog.kind === 'confirm' ? false : null)">取消</button><button class="plc-button plc-button-primary" type="button" @click="closeAppDialog(appDialog.kind === 'confirm' ? true : appDialog.value)">确定</button></div>
        </section>
      </div>
      <div v-if="showSkillDetail" class="plc-overlay" @click.self="showSkillDetail = false">
        <section class="plc-skill-modal" role="dialog" aria-modal="true" aria-label="Skill 内容"><div class="plc-modal-heading"><div><p class="plc-eyebrow">SKILL.md</p><h2>{{ snapshot.skills.find((skill) => skill.id === selectedSkillId)?.name }}</h2></div><button class="plc-close-button" type="button" @click="showSkillDetail = false"><IconTablerX /></button></div><pre class="plc-skill-content">{{ selectedSkillContent }}</pre></section>
      </div>
    </template>
  </DesktopLayout>
</template>

<style scoped>
@reference "tailwindcss";

.plc-sidebar { @apply flex h-full min-h-0 flex-col bg-slate-100 px-3 py-3 text-slate-800; }
.plc-sidebar-icon-button, .plc-header-action { @apply flex h-7 min-w-7 items-center justify-center rounded-md border border-transparent bg-transparent px-1.5 text-xs text-slate-500 transition hover:border-slate-200 hover:bg-white hover:text-slate-900; }
.plc-sidebar-icon-button :deep(svg), .plc-header-action :deep(svg) { @apply h-4 w-4; }
.plc-brand-row, .plc-project-row, .plc-session-row, .plc-sidebar-link { @apply flex w-full items-center gap-2 rounded-lg border-0 bg-transparent text-left transition hover:bg-white/80; }
.plc-brand-row { @apply mt-4 px-2 py-2; }
.plc-brand-mark { @apply flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-sm font-semibold text-white; }
.plc-brand-copy, .plc-project-copy, .plc-session-copy { @apply flex min-w-0 flex-1 flex-col gap-0.5; }
.plc-brand-copy strong { @apply text-sm font-semibold tracking-tight; }
.plc-brand-copy small, .plc-project-copy small, .plc-session-copy small, .plc-sidebar-link small { @apply truncate text-[11px] text-slate-500; }
.plc-sidebar-rule { @apply my-3 h-px bg-slate-200; }
.plc-sidebar-label { @apply px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400; }
.plc-project-heading { @apply flex items-center justify-between; }
.plc-sidebar-label-inline { @apply px-2; }
.plc-sidebar-add-button { @apply flex h-6 w-6 items-center justify-center rounded-md border-0 bg-transparent text-slate-500 transition hover:bg-white hover:text-slate-900; }
.plc-sidebar-add-button :deep(svg) { @apply h-4 w-4; }
.plc-sidebar-label-spaced { @apply mt-5; }
.plc-project-row { @apply mt-2 px-2 py-2; }
.plc-project-list { @apply mt-1 grid gap-0.5 border-l border-slate-200 pl-1.5; }
.plc-project-list { max-height: 22vh; overflow-y: auto; }
.plc-project-list-row { @apply flex min-w-0 items-center gap-1 rounded-md transition hover:bg-white/80; }
.plc-project-list-row.is-active { @apply bg-white shadow-sm; }
.plc-project-list-main { @apply flex min-w-0 flex-1 items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1.5 text-left; }
.plc-project-list-main .plc-project-copy strong { @apply text-[11px] font-medium; }
.plc-project-list-main .plc-project-copy small { @apply text-[10px]; }
.plc-project-remove, .plc-session-action { @apply flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-slate-400 transition hover:bg-slate-200 hover:text-slate-700; }
.plc-project-remove :deep(svg), .plc-session-action :deep(svg) { @apply h-3.5 w-3.5; }
.plc-project-status, .plc-header-status, .plc-session-dot { @apply h-2 w-2 shrink-0 rounded-full bg-slate-300; }
.plc-project-status[data-state='ok'], .plc-header-status[data-state='ok'] { @apply bg-emerald-500; }
.plc-header-status[data-state='busy'] { @apply animate-pulse bg-amber-500; }
.plc-session-dot { @apply h-1.5 w-1.5 bg-slate-300; }
.plc-session-row { @apply mt-0.5 flex min-w-0 items-center gap-0.5 rounded-lg px-1.5 py-1; }
.plc-session-list { min-height: 0; max-height: 38vh; overflow-y: auto; }
.plc-session-main { @apply flex min-w-0 flex-1 items-center gap-2 rounded-md border-0 bg-transparent px-0.5 py-1 text-left; }
.plc-session-action { @apply opacity-0; }
.plc-session-row:hover .plc-session-action, .plc-session-row.is-active .plc-session-action { @apply opacity-100; }
.plc-session-delete:hover, .plc-project-remove:hover { @apply bg-rose-100 text-rose-700; }
.plc-session-row.is-active { @apply bg-white shadow-sm; }
.plc-session-row.is-active .plc-session-dot { @apply bg-amber-500; }
.plc-empty-side { @apply px-2 py-3 text-xs leading-5 text-slate-400; }
.plc-sidebar-grow { @apply min-h-4 flex-1; }
.plc-sidebar-link { @apply px-2 py-2 text-slate-600; }
.plc-sidebar-link + .plc-sidebar-link { @apply mt-1; }
.plc-sidebar-link.is-active { @apply bg-white text-slate-900 shadow-sm; }
.plc-sidebar-link :deep(svg) { @apply h-4 w-4 shrink-0; }
.plc-sidebar-link span { @apply flex min-w-0 flex-1 flex-col gap-0.5; }
.plc-sidebar-link strong { @apply text-xs font-medium; }

.plc-content { @apply flex h-full min-h-0 flex-col bg-white; }
.plc-chat-layout { @apply flex min-h-0 flex-1 flex-col; }
.plc-conversation { @apply min-h-0 flex-1; }
.plc-composer { @apply shrink-0 px-3 pb-3; }
.plc-detail-layout { @apply min-h-0 flex-1 overflow-y-auto bg-zinc-50/60 px-4 py-5 sm:px-8; }
.plc-detail-section { @apply mx-auto mb-4 max-w-4xl rounded-xl bg-white p-5 shadow-[0_0_0_1px_rgba(0,0,0,.06),0_8px_20px_rgba(0,0,0,.04)]; }
.plc-section-heading, .plc-modal-heading { @apply flex items-start justify-between gap-4; }
.plc-eyebrow { @apply m-0 text-[10px] font-semibold uppercase tracking-[0.17em] text-amber-600; }
.plc-section-heading h2, .plc-modal-heading h2 { @apply mt-1 text-lg font-semibold tracking-tight text-zinc-900; }
.plc-section-meta { @apply text-xs text-slate-400; }
.plc-project-picker { @apply mt-5 flex gap-2; }
.plc-project-picker input { @apply min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none transition focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-100; }
.plc-project-folder-button { @apply w-9 shrink-0 px-0; }
.plc-project-folder-button :deep(svg) { @apply h-4 w-4; }
.plc-fact-grid { @apply mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-slate-200 sm:grid-cols-4; }
.plc-fact-grid > div { @apply flex flex-col gap-1 bg-white px-3 py-3; }
.plc-fact-grid span { @apply text-[10px] uppercase tracking-wider text-slate-400; }
.plc-fact-grid strong { @apply text-sm font-medium text-zinc-800; }
.plc-fact-grid strong[data-state='warning'] { @apply text-amber-600; }
.plc-inline-note { @apply mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800; }
.plc-file-list, .plc-tool-list { @apply mt-4 divide-y divide-slate-100 rounded-lg border border-slate-100; }
.plc-file-list li { @apply px-3 py-2 text-xs text-slate-600; }
.plc-file-list code { @apply break-all font-mono text-[11px]; }
.plc-empty-row { @apply text-slate-400; }
.plc-diagnostic-list { @apply mt-4 divide-y divide-slate-100 rounded-lg border border-slate-100; }
.plc-diagnostic-list li { @apply flex items-start gap-3 px-3 py-3 text-xs; }
.plc-diagnostic-list li > span { @apply mt-0.5 min-w-10 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold; }
.plc-diagnostic-list li[data-severity='error'] > span { @apply bg-rose-50 text-rose-700; }
.plc-diagnostic-list li[data-severity='warning'] > span { @apply bg-amber-50 text-amber-700; }
.plc-diagnostic-list li[data-severity='info'] > span { @apply bg-slate-100 text-slate-600; }
.plc-diagnostic-list li > div { @apply flex min-w-0 flex-col gap-1; }
.plc-diagnostic-list strong { @apply font-medium leading-5 text-zinc-800; }
.plc-diagnostic-list small { @apply font-mono text-[10px] text-slate-400; }
.plc-tool-list li { @apply flex flex-wrap items-center gap-2 px-3 py-2; }
.plc-tool-list li > span { @apply rounded px-1.5 py-0.5 text-[10px] text-emerald-700 bg-emerald-50; }
.plc-tool-list li > span[data-mutating='true'] { @apply bg-amber-50 text-amber-700; }
.plc-tool-list code { @apply text-xs text-zinc-800; }
.plc-tool-list small { @apply basis-full pl-0 text-[11px] text-slate-400; }
.plc-skill-grid { @apply mt-5 grid gap-2; }
.plc-skill-card { @apply flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 text-left transition hover:border-amber-200 hover:bg-amber-50; }
.plc-skill-badge { @apply flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-amber-300; }
.plc-skill-badge :deep(svg) { @apply h-4 w-4; }
.plc-skill-card > span:nth-child(2) { @apply flex min-w-0 flex-1 flex-col gap-1; }
.plc-skill-card strong { @apply text-sm font-medium text-zinc-800; }
.plc-skill-card small { @apply text-xs leading-5 text-slate-500; }
.plc-skill-arrow { @apply text-lg text-slate-300; }
.plc-safety-note { @apply border-l-2 border-amber-400; }
.plc-safety-note h2 { @apply mt-2 text-base font-semibold; }
.plc-safety-note p:last-child { @apply mt-2 max-w-2xl text-sm leading-6 text-slate-600; }

.plc-approval-strip { @apply mx-3 mb-2 shrink-0 rounded-xl border border-amber-200 bg-amber-50/70 p-3; }
.plc-approval-heading { @apply mb-2 flex items-center gap-2 text-xs font-semibold text-amber-800; }
.plc-approval-heading span:last-child { @apply rounded-full bg-amber-200 px-1.5 text-[10px]; }
.plc-approval-dot { @apply h-2 w-2 rounded-full bg-amber-500; }
.plc-approval-card { @apply grid gap-2 rounded-lg bg-white p-3 shadow-sm sm:grid-cols-[1fr_auto] sm:items-start; }
.plc-approval-card + .plc-approval-card { @apply mt-2; }
.plc-approval-copy { @apply flex min-w-0 flex-col gap-1; }
.plc-approval-copy strong { @apply text-xs font-semibold text-zinc-800; }
.plc-approval-copy small { @apply text-xs leading-5 text-slate-600; }
.plc-approval-copy code { @apply text-[10px] text-slate-400; }
.plc-approval-diff { @apply text-xs text-slate-500; }
.plc-approval-diff pre { @apply mt-2 max-h-32 max-w-full overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-200; }
.plc-approval-actions { @apply flex justify-end gap-2 sm:col-span-2; }
.plc-button { @apply inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50; }
.plc-button :deep(svg) { @apply h-3.5 w-3.5; }
.plc-button-primary { @apply bg-zinc-900 text-white hover:bg-zinc-700; }
.plc-button-quiet { @apply border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50; }
.plc-link-button { @apply border-0 bg-transparent text-xs text-amber-700 hover:text-amber-900; }

.plc-overlay { @apply fixed inset-0 z-[500] flex items-center justify-center bg-zinc-950/45 p-4; }
.plc-command-palette, .plc-settings-modal, .plc-skill-modal { @apply max-h-[min(720px,calc(100vh-2rem))] w-full overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl; }
.plc-command-palette { @apply max-w-lg; }
.plc-command-palette { max-width: 460px; max-height: min(560px, calc(100vh - 5rem)); padding: 14px; border-radius: 12px; }
.plc-settings-modal { @apply max-w-5xl; }
.plc-skill-modal { @apply max-w-3xl; }
.plc-close-button { @apply flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-700; }
.plc-close-button :deep(svg) { @apply h-4 w-4; }
.plc-command-row { @apply flex w-full items-center gap-3 border-0 border-b border-slate-100 bg-transparent px-2 py-3 text-left transition hover:bg-amber-50; }
.plc-command-row { min-height: 42px; gap: 10px; padding: 8px 7px; }
.plc-command-row code { @apply w-20 shrink-0 text-xs text-sky-600; }
.plc-command-row span { @apply flex min-w-0 flex-1 flex-col gap-0.5; }
.plc-command-row strong { @apply text-xs font-medium text-zinc-800; }
.plc-command-row small { display: block; max-width: 270px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: #737373; }
.plc-command-row kbd { @apply text-xs text-slate-300; }
.plc-settings-group { @apply mt-5 grid gap-3 border-t border-slate-100 pt-4; }
.plc-settings-group-title { @apply text-xs font-semibold text-zinc-800; }
.plc-settings-storage { @apply grid gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2; }
.plc-settings-storage > span { @apply text-[10px] font-semibold uppercase tracking-wider text-slate-400; }
.plc-settings-storage code { @apply break-all font-mono text-[11px] text-zinc-700; }
.plc-settings-storage small { @apply text-[10px] text-slate-400; }
.plc-settings-group label { @apply grid gap-1 text-xs font-medium text-slate-600; }
.plc-settings-group label small { @apply font-normal text-slate-400; }
.plc-settings-group input, .plc-settings-group select { @apply rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-zinc-800 outline-none focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-100; }
.plc-model-row { @apply grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end; }
.plc-model-discover-button { @apply min-h-8 whitespace-nowrap; }
.plc-model-discovery { @apply grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3; }
.plc-model-discovery-meta { @apply flex min-w-0 flex-col gap-1 text-[11px] text-slate-500; }
.plc-model-discovery-meta code { @apply break-all font-mono text-[10px] text-slate-400; }
.plc-model-discovery-list { @apply grid max-h-44 gap-1 overflow-y-auto; }
.plc-model-option { @apply flex min-w-0 items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-left text-xs text-zinc-700 transition hover:border-sky-300 hover:bg-sky-50; }
.plc-model-option span, .plc-model-option code { @apply min-w-0 truncate; }
.plc-model-option code { @apply font-mono text-[10px] text-slate-400; }
.plc-model-discovery-empty, .plc-model-discovery-error { @apply m-0 text-xs leading-5; }
.plc-model-discovery-empty { @apply text-slate-500; }
.plc-model-discovery-error { @apply rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700; }
.plc-settings-theme { @apply flex items-center gap-2; }
.plc-settings-theme > span { @apply mr-auto text-xs font-medium text-slate-600; }
.plc-theme-choice { @apply rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600; }
.plc-theme-choice.is-active { @apply border-zinc-900 bg-zinc-900 text-white; }
.plc-skill-content { @apply mt-5 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-4 font-mono text-xs leading-5 text-zinc-200; }
.plc-toast { @apply fixed bottom-5 left-1/2 z-[600] -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-xs text-white shadow-xl; }
.plc-info-dialog { width: min(420px, calc(100vw - 32px)); border: 1px solid rgba(128,128,128,.25); border-radius: 12px; background: var(--plc-dialog-bg, #fff); color: var(--plc-dialog-text, #333); padding: 18px; box-shadow: 0 18px 48px rgba(0,0,0,.24); }
.plc-info-dialog-copy { margin: 16px 0; color: #666; font-size: 13px; line-height: 1.7; }
.plc-reward-placeholder { display: grid; min-height: 180px; place-items: center; border: 1px dashed #bbb; border-radius: 8px; color: #999; font-size: 12px; }
.plc-app-dialog-input { width: 100%; box-sizing: border-box; border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; background: transparent; color: inherit; }
.plc-app-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.plc-dialog-overlay { z-index: 800; }
:global(.dark .plc-info-dialog) { --plc-dialog-bg: #252526; --plc-dialog-text: #d4d4d4; }
:global(.dark .plc-info-dialog-copy) { color: #aaa; }
:global(.dark .plc-app-dialog-input) { border-color: #555; }
.plc-window-drop-overlay { @apply pointer-events-none fixed inset-3 z-[700] flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-sky-500 bg-sky-500/10 text-sky-700 backdrop-blur-sm; }
.plc-window-drop-overlay :deep(svg) { @apply h-8 w-8; }
.plc-window-drop-overlay strong { @apply text-base font-semibold; }
.plc-window-drop-overlay span { @apply text-xs; }
.plc-fade-enter-active, .plc-fade-leave-active { @apply transition duration-200; }
.plc-fade-enter-from, .plc-fade-leave-to { @apply translate-y-2 opacity-0; }

:global(:root.dark) .plc-sidebar { @apply bg-zinc-900 text-zinc-100; }
:global(:root.dark) .plc-sidebar-rule { @apply bg-zinc-700; }
:global(:root.dark) .plc-sidebar-label, :global(:root.dark) .plc-brand-copy small, :global(:root.dark) .plc-project-copy small, :global(:root.dark) .plc-session-copy small, :global(:root.dark) .plc-sidebar-link small { @apply text-zinc-500; }
:global(:root.dark) .plc-brand-mark { @apply bg-zinc-100 text-zinc-900; }
:global(:root.dark) .plc-brand-row:hover, :global(:root.dark) .plc-project-row:hover, :global(:root.dark) .plc-session-row:hover, :global(:root.dark) .plc-sidebar-link:hover, :global(:root.dark) .plc-sidebar-link.is-active, :global(:root.dark) .plc-session-row.is-active { @apply bg-zinc-800; }
:global(:root.dark) .plc-project-list { @apply border-zinc-700; }
:global(:root.dark) .plc-project-list-row:hover, :global(:root.dark) .plc-project-list-row.is-active { @apply bg-zinc-800; }
:global(:root.dark) .plc-sidebar-add-button:hover, :global(:root.dark) .plc-project-remove:hover, :global(:root.dark) .plc-session-action:hover { @apply bg-zinc-700 text-zinc-100; }
:global(:root.dark) .plc-session-delete:hover, :global(:root.dark) .plc-project-remove:hover { @apply bg-rose-950 text-rose-200; }
:global(:root.dark) .plc-content, :global(:root.dark) .plc-detail-layout { @apply bg-zinc-950; }
:global(:root.dark) .plc-detail-section, :global(:root.dark) .plc-approval-card, :global(:root.dark) .plc-command-palette, :global(:root.dark) .plc-settings-modal, :global(:root.dark) .plc-skill-modal { @apply bg-zinc-900 text-zinc-100; }
:global(:root.dark) .plc-section-heading h2, :global(:root.dark) .plc-modal-heading h2, :global(:root.dark) .plc-fact-grid strong, :global(:root.dark) .plc-skill-card strong, :global(:root.dark) .plc-command-row strong, :global(:root.dark) .plc-settings-group-title { @apply text-zinc-100; }
:global(:root.dark) .plc-settings-storage { border-color: var(--plc-dark-border); background-color: var(--plc-dark-surface-raised); }
:global(:root.dark) .plc-settings-storage > span, :global(:root.dark) .plc-settings-storage small { color: var(--plc-dark-subtle); }
:global(:root.dark) .plc-settings-storage code { color: var(--plc-dark-text); }
:global(:root.dark) .plc-project-picker input, :global(:root.dark) .plc-settings-group input, :global(:root.dark) .plc-settings-group select { @apply border-zinc-700 bg-zinc-800 text-zinc-100; }
:global(:root.dark) .plc-model-discovery { border-color: var(--plc-dark-border); background-color: var(--plc-dark-surface-raised); }
:global(:root.dark) .plc-model-discovery-meta { color: var(--plc-dark-muted); }
:global(:root.dark) .plc-model-discovery-meta code, :global(:root.dark) .plc-model-option code { color: var(--plc-dark-subtle); }
:global(:root.dark) .plc-model-option { border-color: var(--plc-dark-border); background-color: var(--plc-dark-surface); color: var(--plc-dark-text); }
:global(:root.dark) .plc-model-option:hover { border-color: rgba(0, 122, 204, 0.65); background-color: #2a2d2e; }
:global(:root.dark) .plc-model-discovery-empty { color: var(--plc-dark-muted); }
:global(:root.dark) .plc-model-discovery-error { border-color: rgba(244, 135, 113, 0.45); background-color: var(--plc-dark-error-bg); color: var(--plc-dark-error); }
:global(:root.dark) .plc-fact-grid { @apply bg-zinc-700; }
:global(:root.dark) .plc-fact-grid > div, :global(:root.dark) .plc-file-list, :global(:root.dark) .plc-tool-list { @apply bg-zinc-900; }
:global(:root.dark) .plc-file-list, :global(:root.dark) .plc-tool-list, :global(:root.dark) .plc-file-list li, :global(:root.dark) .plc-tool-list li, :global(:root.dark) .plc-command-row, :global(:root.dark) .plc-settings-group { @apply border-zinc-800; }
:global(:root.dark) .plc-file-list li, :global(:root.dark) .plc-tool-list small, :global(:root.dark) .plc-safety-note p:last-child { @apply text-zinc-400; }
:global(:root.dark) .plc-diagnostic-list { @apply border-zinc-800 divide-zinc-800; }
:global(:root.dark) .plc-diagnostic-list strong { @apply text-zinc-100; }
:global(:root.dark) .plc-diagnostic-list small { @apply text-zinc-500; }
:global(:root.dark) .plc-diagnostic-list li[data-severity='error'] > span { @apply bg-rose-950 text-rose-200; }
:global(:root.dark) .plc-diagnostic-list li[data-severity='warning'] > span { background-color: var(--plc-dark-warning-bg); color: var(--plc-dark-warning); }
:global(:root.dark) .plc-diagnostic-list li[data-severity='info'] > span { @apply bg-zinc-800 text-zinc-400; }
:global(:root.dark) .plc-skill-card { border-color: var(--plc-dark-border); background-color: var(--plc-dark-surface-raised); }
:global(:root.dark) .plc-button-quiet, :global(:root.dark) .plc-theme-choice { @apply border-zinc-700 bg-zinc-800 text-zinc-200; }
:global(:root.dark) .plc-toast { @apply bg-zinc-100 text-zinc-900; }
:global(:root.dark) .plc-window-drop-overlay { @apply border-sky-400 bg-sky-400/10 text-sky-300; }

@media (max-width: 767px) {
  .plc-sidebar { @apply px-3; }
  .plc-detail-layout { @apply px-3 py-3; }
  .plc-detail-section { @apply p-4; }
  .plc-composer { @apply px-2 pb-2; }
}
</style>
