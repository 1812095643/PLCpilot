<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, watch, type ComponentPublicInstance } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import DesktopLayout from './components/layout/DesktopLayout.vue'
import SidebarThreadControls from './components/sidebar/SidebarThreadControls.vue'
import ContentHeader from './components/content/ContentHeader.vue'
import ThreadConversation from './components/content/ThreadConversation.vue'
import ThreadComposer from './components/content/ThreadComposer.vue'
import type { ComposerDraftPayload, ThreadComposerExposed, SubmitPayload } from './components/content/ThreadComposer.vue'
import IconTablerBolt from './components/icons/IconTablerBolt.vue'
import IconTablerSettings from './components/icons/IconTablerSettings.vue'
import IconTablerSearch from './components/icons/IconTablerSearch.vue'
import IconTablerTerminal from './components/icons/IconTablerTerminal.vue'
import IconTablerX from './components/icons/IconTablerX.vue'
import {
  approveChange,
  abortAgent,
  compactContext,
  compileProject,
  discoverModels,
  EMPTY_SNAPSHOT,
  getSkillContent,
  getSnapshot,
  rejectChange,
  resumeSession,
  runAgent,
  saveMcp,
  saveModel,
  selectProject,
  syncCurrentProject,
  type AgentEvent,
  type AgentResult,
  type AgentRunOptions,
  type ModelDiscoveryResult,
  type McpForm,
  type ModelForm,
  type PendingChange,
  type SessionRecord,
  type Snapshot,
} from './api/plcBridge'
import type {
  CollaborationModeKind,
  UiLiveOverlay,
  UiMessage,
  UiThreadTokenUsage,
} from './types/codex'
import type { Diagnostic } from './api/plcBridge'

type Theme = 'dark' | 'light'
type View = 'chat' | 'overview' | 'skills'

const snapshot = shallowRef<Snapshot>(EMPTY_SNAPSHOT)
const messages = shallowRef<UiMessage[]>([])
const activeView = shallowRef<View>('chat')
const activeThreadId = shallowRef('local-plc-thread')
const isSidebarCollapsed = shallowRef(false)
const isBusy = shallowRef(false)
const isRefreshing = shallowRef(false)
const notice = shallowRef('')
const isDiscoveringModels = shallowRef(false)
const modelDiscovery = shallowRef<ModelDiscoveryResult | null>(null)
const modelDiscoveryError = shallowRef('')
const liveOverlay = shallowRef<UiLiveOverlay | null>(null)
const diagnostics = shallowRef<Diagnostic[]>([])
const diagnosticNote = shallowRef('')
const showSettings = shallowRef(false)
const showCommandPalette = shallowRef(false)
const showSkillDetail = shallowRef(false)
const selectedSkillId = shallowRef('')
const selectedSkillContent = shallowRef('')
const projectPathDraft = shallowRef('')
const composerRef = shallowRef<ComponentPublicInstance<ThreadComposerExposed> | null>(null)
const theme = shallowRef<Theme>(loadTheme())
const collaborationMode = shallowRef<CollaborationModeKind>('default')
const selectedModel = shallowRef('gpt-5')
const reasoningEffort = shallowRef<'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'>('medium')
const modelForm = shallowRef<ModelForm>({
  provider: 'responses',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5',
  apiKey: '',
})
const mcpForm = shallowRef<McpForm>({
  id: 'codesys',
  name: 'CODESYS MCP',
  command: '',
  args: '',
  transport: 'stdio',
  url: '',
  authToken: '',
})

const fallbackCommands = [
  { command: '/help', label: '帮助', detail: '查看命令和安全边界', supports_args: false },
  { command: '/status', label: '运行状态', detail: '工程、模型和会话状态', supports_args: false },
  { command: '/scan', label: '扫描工程', detail: '读取工程树和源对象', supports_args: false },
  { command: '/skills', label: 'Skills', detail: '查看内置 PLC Skills', supports_args: true },
  { command: '/mcp', label: 'MCP', detail: '查看 MCP 服务和工具', supports_args: true },
  { command: '/tools', label: '工具目录', detail: '列出可调用工具', supports_args: false },
  { command: '/model', label: '获取模型', detail: '从当前接口读取 /models 或 /model 列表', supports_args: false },
  { command: '/compact', label: '压缩上下文', detail: '保留关键结论并释放上下文', supports_args: true },
  { command: '/compile', label: '编译诊断', detail: '调用 CODESYS 编译/诊断闭环', supports_args: false },
  { command: '/new', label: '新会话', detail: '清空当前对话，不改工程', supports_args: false },
  { command: '/stop', label: '停止任务', detail: '停止当前工具轮次', supports_args: false },
]

const commands = computed(() => snapshot.value.commands.length > 0 ? snapshot.value.commands : fallbackCommands)
const modelOptions = computed(() => {
  const configured = snapshot.value.model.model.trim()
  const discovered = modelDiscovery.value?.models.map((model) => model.id) || []
  return Array.from(new Set([...discovered, configured, selectedModel.value, 'gpt-5'].filter(Boolean)))
})
const currentProject = computed(() => snapshot.value.project)
const currentCwd = computed(() => currentProject.value.working_directory || currentProject.value.project_directory || currentProject.value.path || '')
const currentTitle = computed(() => snapshot.value.session.name || currentProject.value.name || 'PLC Pilot')
const skills = computed(() => snapshot.value.skills.map((skill) => ({
  name: skill.name,
  displayName: skill.name,
  description: skill.description,
  path: skill.path || `builtin://${skill.id}`,
  scope: skill.scope,
  enabled: skill.enabled,
})))
const pendingChanges = computed(() => snapshot.value.pending_changes.filter((item) => item.status === 'pending'))
const tokenUsage = computed<UiThreadTokenUsage | null>(() => {
  const session = snapshot.value.session
  if (!session.context_window && !session.tokens.total) return null
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
    modelContextWindow: session.context_window || null,
    currentContextTokens: session.context_tokens,
    remainingContextTokens: session.context_window ? Math.max(0, session.context_window - session.context_tokens) : null,
    remainingContextPercent: session.context_window ? Math.max(0, 100 - session.context_percent) : null,
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

function loadTheme(): Theme {
  try {
    return window.localStorage.getItem('plc-pilot-theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function applyTheme(value: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', value === 'dark')
  document.documentElement.dataset.theme = value
  try {
    window.localStorage.setItem('plc-pilot-theme', value)
  } catch {
    // 桌面运行时禁用存储时仍保留当前窗口主题。
  }
}

function newId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

function showNotice(message: string): void {
  notice.value = message
  window.setTimeout(() => {
    if (notice.value === message) notice.value = ''
  }, 5000)
}

async function refresh(): Promise<void> {
  if (isRefreshing.value) return
  isRefreshing.value = true
  try {
    const next = await getSnapshot()
    snapshot.value = next
    projectPathDraft.value = next.project.path || ''
    selectedModel.value = next.model.model || selectedModel.value
    modelForm.value = {
      provider: next.model.provider,
      baseUrl: next.model.base_url,
      model: next.model.model,
      apiKey: '',
    }
    modelDiscovery.value = null
    modelDiscoveryError.value = ''
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

function eventToMessage(event: AgentEvent, turnIndex: number): UiMessage {
  const status = event.status === 'warning' || event.status === 'error' ? 'failed' : event.status === 'done' || event.status === 'approved' ? 'completed' : 'inProgress'
  return {
    id: event.id || newId('event'),
    role: 'system',
    text: event.detail || event.title,
    messageType: 'commandExecution',
    turnId: `turn-${turnIndex}`,
    turnIndex,
    commandExecution: {
      command: event.tool || event.kind || event.title,
      cwd: currentCwd.value || null,
      status,
      aggregatedOutput: event.detail || event.title,
      exitCode: status === 'completed' ? 0 : null,
    },
  }
}

function appendAgentResult(result: AgentResult, userText: string, selectedSkills: Array<{ name: string; path: string }> = []): void {
  const turnIndex = messages.value.filter((item) => item.role === 'user').length
  const userMessage: UiMessage = {
    id: newId('user'),
    role: 'user',
    text: userText,
    skills: selectedSkills.length > 0 ? selectedSkills : undefined,
    turnId: `turn-${turnIndex}`,
    turnIndex,
  }
  const resultMessages = result.events.map((event) => eventToMessage(event, turnIndex))
  const assistantMessage: UiMessage = {
    id: newId('assistant'),
    role: 'assistant',
    text: result.text,
    turnId: `turn-${turnIndex}`,
    turnIndex,
  }
  messages.value = [...messages.value.filter((item) => !item.id.startsWith('pending-assistant-')), userMessage, ...resultMessages, assistantMessage]
  snapshot.value = {
    ...snapshot.value,
    pending_changes: result.pending_changes,
    session: result.session,
  }
  diagnostics.value = result.diagnostics
  diagnosticNote.value = result.diagnostics.length > 0 ? '本轮 Agent 返回了诊断项。' : ''
  liveOverlay.value = null
  if (result.pending_changes.some((item) => item.status === 'pending')) activeView.value = 'overview'
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

async function onSubmit(payload: SubmitPayload): Promise<void> {
  const text = payload.text.trim()
  if (!text || isBusy.value) return
  isBusy.value = true
  liveOverlay.value = {
    activityLabel: '正在处理 PLC 任务',
    activityDetails: ['读取当前工程快照', '按审批边界规划工具调用'],
    reasoningText: '',
    errorText: '',
  }
  const baseMessages = messages.value
  messages.value = [
    ...baseMessages,
    { id: newId('user'), role: 'user', text },
    { id: `pending-assistant-${newId('turn')}`, role: 'assistant', text: '正在读取工程上下文…' },
  ]
  try {
    const history = baseMessages
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .map((item) => ({ role: item.role, content: item.text }))
    const runOptions: AgentRunOptions = {
      model: selectedModel.value,
      reasoningEffort: reasoningEffort.value,
      collaborationMode: collaborationMode.value,
      skills: payload.skills,
    }
    const result = await runAgent(text, history, agentContext.value, runOptions)
    // runAgent 返回的是本轮完整结果；以发送前的历史为基线，避免把本轮用户消息
    // 误当成历史再次拼接，或者在占位消息清理时误删上一轮消息。
    messages.value = baseMessages
    appendAgentResult(result, text, payload.skills)
    await refresh()
  } catch (error) {
    messages.value = messages.value.map((item) => item.id.startsWith('pending-assistant-')
      ? { ...item, text: `这次任务还没有完成：${error instanceof Error ? error.message : String(error)}` }
      : item)
    liveOverlay.value = null
  } finally {
    isBusy.value = false
  }
}

async function onCompact(): Promise<void> {
  if (isBusy.value) return
  isBusy.value = true
  try {
    const result = await compactContext('', agentContext.value)
    messages.value = [...messages.value, eventToMessage({
      id: newId('compact'),
      kind: 'compact',
      title: '已压缩当前上下文',
      detail: result.text,
      status: 'done',
      tool: 'compact_context',
    }, messages.value.length)]
    snapshot.value = { ...snapshot.value, session: result.session }
    diagnostics.value = result.diagnostics
    diagnosticNote.value = result.diagnostics.length > 0 ? '压缩前保留了本轮诊断项。' : ''
    showNotice('上下文已压缩，关键工程结论已保留。')
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  } finally {
    isBusy.value = false
  }
}

async function onInterrupt(): Promise<void> {
  if (!isBusy.value) return
  try {
    const result = await abortAgent()
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

async function onSelectProject(): Promise<void> {
  const path = projectPathDraft.value.trim()
  if (!path) {
    showNotice('请输入 CODESYS 工程文件或目录路径。')
    return
  }
  try {
    snapshot.value = { ...snapshot.value, project: await selectProject(path) }
    activeView.value = 'overview'
    showNotice('工程上下文已更新。')
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

async function onResumeSession(record: SessionRecord): Promise<void> {
  try {
    const resumed = await resumeSession(record.path)
    activeThreadId.value = resumed.session_id
    messages.value = resumed.messages.map((item, index) => ({
      id: newId(item.role),
      role: item.role === 'assistant' ? 'assistant' : 'user',
      text: item.content,
      turnIndex: index,
      turnId: `restored-${index}`,
    }))
    snapshot.value = {
      ...snapshot.value,
      session: { ...snapshot.value.session, session_id: resumed.session_id, session_file: resumed.path, name: resumed.name, message_count: resumed.message_count },
    }
    activeView.value = 'chat'
    showNotice(`已恢复会话：${resumed.name || resumed.session_id.slice(0, 12)}`)
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

async function onApprove(change: PendingChange): Promise<void> {
  try {
    await approveChange(change.id)
    showNotice('修改已通过审批，请重新编译验证。')
    await refresh()
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

async function onReject(change: PendingChange): Promise<void> {
  try {
    await rejectChange(change.id)
    showNotice('已拒绝这次工程修改。')
    await refresh()
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

async function onSaveModel(): Promise<void> {
  try {
    snapshot.value = { ...snapshot.value, model: await saveModel(modelForm.value) }
    selectedModel.value = modelForm.value.model
    showSettings.value = false
    showNotice('模型配置已保存到本机运行时。')
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }
}

function selectDiscoveredModel(modelId: string): void {
  modelForm.value = { ...modelForm.value, model: modelId }
  selectedModel.value = modelId
}

async function onDiscoverModels(): Promise<void> {
  modelDiscoveryError.value = ''
  isDiscoveringModels.value = true
  try {
    const result = await discoverModels({ ...modelForm.value })
    modelDiscovery.value = result
    showNotice(result.models.length > 0 ? `已获取 ${result.models.length} 个可用模型。` : '接口已响应，但没有返回可用模型。')
  } catch (error) {
    modelDiscovery.value = null
    modelDiscoveryError.value = error instanceof Error ? error.message : String(error)
    showNotice('模型列表获取未完成，请查看设置面板中的原因。')
  } finally {
    isDiscoveringModels.value = false
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
  }
  composerRef.value?.hydrateDraft(payload)
  if (!supportsArgs) void onSubmit({ text: command, skills: [], mode: 'steer' })
}

function startNewThread(): void {
  activeThreadId.value = `local-${Date.now()}`
  messages.value = []
  diagnostics.value = []
  diagnosticNote.value = ''
  snapshot.value = { ...snapshot.value, session: { ...snapshot.value.session, session_id: null, session_file: null, name: null, message_count: 0 } }
  activeView.value = 'chat'
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

let stopListening: UnlistenFn | undefined
let syncTimer: number | undefined

watch(theme, applyTheme, { immediate: true })

onMounted(async () => {
  await refresh()
  window.addEventListener('keydown', onKeyDown)
  try {
    stopListening = await listen<AgentEvent>('agent-event', (event) => {
      const item = event.payload
      liveOverlay.value = {
        activityLabel: item.title,
        activityDetails: item.detail ? [item.detail] : [],
        reasoningText: '',
        errorText: item.status === 'warning' || item.status === 'error' ? item.detail || '' : '',
      }
    })
  } catch {
    // 浏览器预览没有 Tauri 事件桥接，仍可查看静态界面。
  }
  syncTimer = window.setInterval(() => {
    void syncCurrentProject().then((project) => {
      snapshot.value = { ...snapshot.value, project }
      projectPathDraft.value = project.path || projectPathDraft.value
    }).catch(() => undefined)
  }, 4000)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  stopListening?.()
  if (syncTimer) window.clearInterval(syncTimer)
})
</script>

<template>
  <DesktopLayout :is-sidebar-collapsed="isSidebarCollapsed" @close-sidebar="isSidebarCollapsed = true">
    <template #sidebar>
      <aside class="plc-sidebar">
        <SidebarThreadControls
          :is-sidebar-collapsed="isSidebarCollapsed"
          :show-new-thread-button="true"
          @toggle-sidebar="isSidebarCollapsed = !isSidebarCollapsed"
          @start-new-thread="startNewThread"
        >
          <button class="plc-sidebar-icon-button" type="button" title="搜索线程" aria-label="搜索线程" @click="showCommandPalette = true">
            <IconTablerSearch />
          </button>
        </SidebarThreadControls>

        <button class="plc-brand-row" type="button" @click="activeView = 'chat'">
          <span class="plc-brand-mark">P</span>
          <span class="plc-brand-copy"><strong>PLC Pilot</strong><small>CODESYS 3.5.22</small></span>
        </button>

        <div class="plc-sidebar-rule" />
        <p class="plc-sidebar-label">工作区</p>
        <button class="plc-project-row" type="button" @click="activeView = 'overview'">
          <span class="plc-project-status" :data-state="currentProject.exists ? 'ok' : 'idle'" />
          <span class="plc-project-copy"><strong>{{ currentProject.name || '尚未选择工程' }}</strong><small>{{ currentProject.path || '选择一个 .project 或工程目录' }}</small></span>
        </button>

        <p class="plc-sidebar-label plc-sidebar-label-spaced">会话</p>
        <div class="plc-session-list">
          <button
            v-for="record in snapshot.sessions"
            :key="record.path"
            class="plc-session-row"
            :class="{ 'is-active': record.session_id === snapshot.session.session_id }"
            type="button"
            @click="onResumeSession(record)"
          >
            <span class="plc-session-dot" />
            <span class="plc-session-copy"><strong>{{ record.name || record.session_id.slice(0, 12) }}</strong><small>{{ record.message_count }} 条消息</small></span>
          </button>
          <p v-if="snapshot.sessions.length === 0" class="plc-empty-side">发送第一条任务后，会话会自动保留。</p>
        </div>

        <div class="plc-sidebar-grow" />
        <button class="plc-sidebar-link" type="button" :class="{ 'is-active': activeView === 'skills' }" @click="activeView = 'skills'">
          <IconTablerBolt /><span><strong>PLC Skills</strong><small>工程规范与安全审查</small></span>
        </button>
        <button class="plc-sidebar-link" type="button" @click="showSettings = true">
          <IconTablerSettings /><span><strong>设置</strong><small>模型、MCP 和主题</small></span>
        </button>
      </aside>
    </template>

    <template #content>
      <section class="content-root plc-content">
        <ContentHeader :title="currentTitle" :accent="activeView !== 'chat'">
          <template #leading>
            <span class="plc-header-status" :data-state="isBusy ? 'busy' : currentProject.exists ? 'ok' : 'idle'" />
          </template>
          <template #actions>
            <button class="plc-header-action" type="button" title="命令面板" aria-label="命令面板" @click="showCommandPalette = true">⌘K</button>
            <button class="plc-header-action" type="button" title="切换主题" aria-label="切换主题" @click="theme = theme === 'dark' ? 'light' : 'dark'">{{ theme === 'dark' ? '○' : '●' }}</button>
          </template>
        </ContentHeader>

        <div v-if="activeView === 'chat'" class="plc-chat-layout">
          <ThreadConversation
            class="plc-conversation"
            :messages="messages"
            :live-overlay="liveOverlay"
            :is-loading="isBusy && messages.length === 0"
            :active-thread-id="activeThreadId"
            :cwd="currentCwd"
          />

          <section v-if="pendingChanges.length > 0" class="plc-approval-strip" aria-live="polite">
            <div class="plc-approval-heading"><span class="plc-approval-dot" />需要审批的工程修改 <span>{{ pendingChanges.length }}</span></div>
            <article v-for="change in pendingChanges" :key="change.id" class="plc-approval-card">
              <div class="plc-approval-copy"><strong>{{ change.title }}</strong><small>{{ change.description }}</small><code>{{ change.id }}</code></div>
              <details class="plc-approval-diff"><summary>查看 Diff</summary><pre>{{ change.diff }}</pre></details>
              <div class="plc-approval-actions"><button type="button" class="plc-button plc-button-quiet" @click="onReject(change)">拒绝</button><button type="button" class="plc-button plc-button-primary" @click="onApprove(change)">批准并写入</button></div>
            </article>
          </section>

          <ThreadComposer
            ref="composerRef"
            class="plc-composer"
            :active-thread-id="activeThreadId"
            :cwd="currentCwd"
            :collaboration-modes="[{ value: 'default', label: '执行' }, { value: 'plan', label: '计划' }]"
            :selected-collaboration-mode="collaborationMode"
            :models="modelOptions"
            :selected-model="selectedModel"
            :selected-reasoning-effort="reasoningEffort"
            :skills="skills"
            :thread-token-usage="tokenUsage"
            :is-turn-in-progress="isBusy"
            :disabled="false"
            :send-with-enter="true"
            :in-progress-submit-mode="'steer'"
            @submit="onSubmit"
            @interrupt="onInterrupt"
            @update:selected-collaboration-mode="collaborationMode = $event"
            @update:selected-model="selectedModel = $event"
            @update:selected-reasoning-effort="reasoningEffort = $event"
          />
        </div>

        <div v-else-if="activeView === 'overview'" class="plc-detail-layout">
          <section class="plc-detail-section plc-project-overview">
            <div class="plc-section-heading"><div><p class="plc-eyebrow">工程上下文</p><h2>{{ currentProject.name || '选择 CODESYS 工程' }}</h2></div><button class="plc-button plc-button-primary" type="button" @click="onCompile"><IconTablerTerminal /> 编译诊断</button></div>
            <div class="plc-project-picker"><input v-model="projectPathDraft" type="text" placeholder="C:\\Projects\\Machine\\Machine.project" @keydown.enter="onSelectProject" /><button class="plc-button plc-button-quiet" type="button" @click="onSelectProject">读取工程</button></div>
            <div class="plc-fact-grid"><div><span>版本</span><strong>{{ currentProject.version || snapshot.codesys.supported_version }}</strong></div><div><span>源文件</span><strong>{{ currentProject.file_count }}</strong></div><div><span>POU / 源对象</span><strong>{{ currentProject.pou_count }}</strong></div><div><span>扫描</span><strong :data-state="currentProject.scan_status">{{ currentProject.scan_status === 'scanned' ? '已完成' : currentProject.scan_status === 'warning' ? '需注意' : '等待' }}</strong></div></div>
            <p v-if="currentProject.scan_message" class="plc-inline-note">{{ currentProject.scan_message }}</p>
          </section>
          <section class="plc-detail-section"><div class="plc-section-heading"><div><p class="plc-eyebrow">源对象</p><h2>工程文件</h2></div><button class="plc-link-button" type="button" @click="activeView = 'chat'; insertFileMention()">在对话中引用</button></div><ul class="plc-file-list"><li v-for="file in currentProject.source_files.slice(0, 80)" :key="file"><code>{{ file }}</code></li><li v-if="currentProject.source_files.length === 0" class="plc-empty-row">尚未扫描到可读源文件。</li></ul></section>
          <section v-if="diagnostics.length > 0 || diagnosticNote" class="plc-detail-section plc-diagnostics-section"><div class="plc-section-heading"><div><p class="plc-eyebrow">诊断闭环</p><h2>编译与静态检查</h2></div><span class="plc-section-meta">{{ diagnostics.length }} 项</span></div><p v-if="diagnosticNote" class="plc-inline-note">{{ diagnosticNote }}</p><ul class="plc-diagnostic-list"><li v-for="(item, index) in diagnostics" :key="`${item.location || 'diagnostic'}-${index}`" :data-severity="item.severity"><span>{{ item.severity === 'error' ? '错误' : item.severity === 'warning' ? '警告' : '提示' }}</span><div><strong>{{ item.message }}</strong><small v-if="item.location || item.code">{{ item.location || '工程级' }}<template v-if="item.code"> · {{ item.code }}</template></small></div></li></ul></section>
          <section v-if="snapshot.tools.length > 0" class="plc-detail-section"><div class="plc-section-heading"><div><p class="plc-eyebrow">工具协议</p><h2>MCP 工具</h2></div></div><ul class="plc-tool-list"><li v-for="tool in snapshot.tools" :key="tool.qualified_name"><span :data-mutating="tool.mutating">{{ tool.mutating ? '审批' : '读取' }}</span><code>{{ tool.qualified_name }}</code><small>{{ tool.description || '未提供描述' }}</small></li></ul></section>
        </div>

        <div v-else class="plc-detail-layout">
          <section class="plc-detail-section"><div class="plc-section-heading"><div><p class="plc-eyebrow">内置能力</p><h2>PLC Skills</h2></div><span class="plc-section-meta">{{ snapshot.skills.length }} 项</span></div><div class="plc-skill-grid"><button v-for="skill in snapshot.skills" :key="skill.id" class="plc-skill-card" type="button" @click="onOpenSkill(skill.id)"><span class="plc-skill-badge"><IconTablerBolt /></span><span><strong>{{ skill.name }}</strong><small>{{ skill.description }}</small></span><span class="plc-skill-arrow">→</span></button></div></section>
          <section class="plc-detail-section plc-safety-note"><p class="plc-eyebrow">默认安全边界</p><h2>先读、再预览、审批后写入</h2><p>工程读取、ST 分析、编译和诊断可以自动进行；修改、删除、下载和在线控制会先生成可审阅的动作卡片。</p></section>
        </div>
      </section>
    </template>
  </DesktopLayout>

  <Transition name="plc-fade"><div v-if="notice" class="plc-toast" role="status">{{ notice }}</div></Transition>

  <div v-if="showCommandPalette" class="plc-overlay" @click.self="showCommandPalette = false">
    <section class="plc-command-palette" role="dialog" aria-modal="true" aria-label="命令面板">
      <div class="plc-modal-heading"><div><p class="plc-eyebrow">快捷入口</p><h2>命令面板</h2></div><button class="plc-close-button" type="button" @click="showCommandPalette = false"><IconTablerX /></button></div>
      <button v-for="item in commands" :key="item.command" class="plc-command-row" type="button" @click="chooseCommand(item.command, item.supports_args)"><code>{{ item.command }}</code><span><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></span><kbd>↵</kbd></button>
    </section>
  </div>

  <div v-if="showSettings" class="plc-overlay" @click.self="showSettings = false">
    <section class="plc-settings-modal" role="dialog" aria-modal="true" aria-label="PLC Pilot 设置">
      <div class="plc-modal-heading"><div><p class="plc-eyebrow">工作台设置</p><h2>连接与外观</h2></div><button class="plc-close-button" type="button" @click="showSettings = false"><IconTablerX /></button></div>
      <div class="plc-settings-storage">
        <span>配置目录</span>
        <code>{{ snapshot.config_directory || '桌面运行时启动后显示' }}</code>
        <small>config.json · auth.json · skills · sessions</small>
      </div>
      <div class="plc-settings-group">
        <label>模型接口
          <select v-model="modelForm.provider">
            <option value="responses">Responses</option>
            <option value="messages">Messages</option>
            <option value="chatcompletions">Chat Completions</option>
            <option value="ollama">Ollama</option>
          </select>
        </label>
        <label>接口地址<input v-model="modelForm.baseUrl" type="url" /></label>
        <div class="plc-model-row">
          <label>模型<input v-model="modelForm.model" type="text" list="plc-discovered-models" /></label>
          <button class="plc-button plc-button-quiet plc-model-discover-button" type="button" :disabled="isDiscoveringModels" @click="onDiscoverModels">
            <IconTablerSearch />
            {{ isDiscoveringModels ? '获取中' : '获取模型' }}
          </button>
        </div>
        <datalist id="plc-discovered-models">
          <option v-for="model in modelDiscovery?.models || []" :key="model.id" :value="model.id">{{ model.name }}</option>
        </datalist>
        <div v-if="modelDiscoveryError" class="plc-model-discovery-error" role="alert">{{ modelDiscoveryError }}</div>
        <div v-else-if="modelDiscovery" class="plc-model-discovery" aria-live="polite">
          <div class="plc-model-discovery-meta">
            <span>HTTP {{ modelDiscovery.status }} · {{ modelDiscovery.models.length }} 个模型</span>
            <code>{{ modelDiscovery.endpoint }}</code>
          </div>
          <div v-if="modelDiscovery.models.length > 0" class="plc-model-discovery-list">
            <button v-for="model in modelDiscovery.models" :key="model.id" class="plc-model-option" type="button" @click="selectDiscoveredModel(model.id)">
              <span>{{ model.name }}</span>
              <code>{{ model.id }}</code>
            </button>
          </div>
          <p v-else class="plc-model-discovery-empty">接口已响应，但没有返回可用模型。</p>
        </div>
        <label>API Key
          <small v-if="snapshot.model.api_key_configured">已保存至 auth.json；留空则继续使用现有 Key</small>
          <small v-else>保存至当前配置目录的 auth.json</small>
          <input v-model="modelForm.apiKey" type="password" autocomplete="off" />
        </label>
        <button class="plc-button plc-button-primary" type="button" @click="onSaveModel">保存模型</button>
      </div>
      <div class="plc-settings-group"><div class="plc-settings-group-title">MCP / Bridge</div><label>服务名称<input v-model="mcpForm.name" type="text" /></label><label>stdio 命令<input v-model="mcpForm.command" type="text" placeholder="python -m codesys_mcp" /></label><label>HTTP URL<input v-model="mcpForm.url" type="url" placeholder="https://..." /></label><button class="plc-button plc-button-quiet" type="button" @click="onSaveMcp">保存 MCP</button></div>
      <div class="plc-settings-group plc-settings-theme"><span>主题</span><button class="plc-theme-choice" :class="{ 'is-active': theme === 'dark' }" type="button" @click="theme = 'dark'">深色</button><button class="plc-theme-choice" :class="{ 'is-active': theme === 'light' }" type="button" @click="theme = 'light'">浅色</button></div>
    </section>
  </div>

  <div v-if="showSkillDetail" class="plc-overlay" @click.self="showSkillDetail = false">
    <section class="plc-skill-modal" role="dialog" aria-modal="true" aria-label="Skill 内容"><div class="plc-modal-heading"><div><p class="plc-eyebrow">SKILL.md</p><h2>{{ snapshot.skills.find((skill) => skill.id === selectedSkillId)?.name }}</h2></div><button class="plc-close-button" type="button" @click="showSkillDetail = false"><IconTablerX /></button></div><pre class="plc-skill-content">{{ selectedSkillContent }}</pre></section>
  </div>
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
.plc-sidebar-label-spaced { @apply mt-5; }
.plc-project-row { @apply mt-2 px-2 py-2; }
.plc-project-status, .plc-header-status, .plc-session-dot { @apply h-2 w-2 shrink-0 rounded-full bg-slate-300; }
.plc-project-status[data-state='ok'], .plc-header-status[data-state='ok'] { @apply bg-emerald-500; }
.plc-header-status[data-state='busy'] { @apply animate-pulse bg-amber-500; }
.plc-session-dot { @apply h-1.5 w-1.5 bg-slate-300; }
.plc-session-row { @apply mt-0.5 px-2 py-2; }
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
.plc-settings-modal { @apply max-w-xl; }
.plc-skill-modal { @apply max-w-3xl; }
.plc-close-button { @apply flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-700; }
.plc-close-button :deep(svg) { @apply h-4 w-4; }
.plc-command-row { @apply flex w-full items-center gap-3 border-0 border-b border-slate-100 bg-transparent px-2 py-3 text-left transition hover:bg-amber-50; }
.plc-command-row code { @apply w-24 shrink-0 text-xs text-amber-700; }
.plc-command-row span { @apply flex min-w-0 flex-1 flex-col gap-0.5; }
.plc-command-row strong { @apply text-sm font-medium text-zinc-800; }
.plc-command-row small { @apply text-xs text-slate-500; }
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
.plc-fade-enter-active, .plc-fade-leave-active { @apply transition duration-200; }
.plc-fade-enter-from, .plc-fade-leave-to { @apply translate-y-2 opacity-0; }

:global(:root.dark) .plc-sidebar { @apply bg-zinc-900 text-zinc-100; }
:global(:root.dark) .plc-sidebar-rule { @apply bg-zinc-700; }
:global(:root.dark) .plc-sidebar-label, :global(:root.dark) .plc-brand-copy small, :global(:root.dark) .plc-project-copy small, :global(:root.dark) .plc-session-copy small, :global(:root.dark) .plc-sidebar-link small { @apply text-zinc-500; }
:global(:root.dark) .plc-brand-mark { @apply bg-zinc-100 text-zinc-900; }
:global(:root.dark) .plc-brand-row:hover, :global(:root.dark) .plc-project-row:hover, :global(:root.dark) .plc-session-row:hover, :global(:root.dark) .plc-sidebar-link:hover, :global(:root.dark) .plc-sidebar-link.is-active, :global(:root.dark) .plc-session-row.is-active { @apply bg-zinc-800; }
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

@media (max-width: 767px) {
  .plc-sidebar { @apply px-3; }
  .plc-detail-layout { @apply px-3 py-3; }
  .plc-detail-section { @apply p-4; }
  .plc-composer { @apply px-2 pb-2; }
}
</style>
