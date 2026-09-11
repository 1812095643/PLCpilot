import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ReasoningEffort, UiAttachment, UiMentionReference, UiMentionKind, UiResponseTextAnnotation } from '../types/codex'

export const openLocalPath = (path: string, mode: 'reveal' | 'default') => invoke<void>('open_local_path', { path, mode })
export const openWebUrl = (url: string) => invoke<void>('open_web_url', { url })

export type ProviderKind = 'responses' | 'messages' | 'chatcompletions' | 'ollama'

export type ProjectContext = {
  path: string | null
  source_root: string | null
  project_directory: string | null
  working_directory: string | null
  snapshot_id: string | null
  project_key: string | null
  name: string | null
  version: string | null
  exists: boolean
  extension: string | null
  file_count: number
  pou_count: number
  source_files: string[]
  scan_status: string
  scan_message: string | null
  active_editor_available: boolean
  active_object: string | null
  active_object_guid: string | null
  active_file: string | null
  active_file_relative: string | null
  active_text: string | null
  selected_text: string | null
  selection_start: number
  selection_length: number
  active_text_truncated: boolean
}

export type WorkspaceProject = {
  id: string
  name: string
  path: string
  exists: boolean
  last_opened_at: string
}

export type ModelSummary = {
  id: string
  name: string
  provider: ProviderKind
  base_url: string
  model: string
  configured: boolean
  api_key_configured: boolean
  context_window: number
  max_tokens: number
  reasoning_levels: string[]
  enabled: boolean
  is_default: boolean
  last_error: string | null
  last_checked_at: string | null
  connection_status: 'unchecked' | 'connected' | 'error' | string
}

export type DiscoveredModel = {
  id: string
  name: string
  owned_by: string | null
}

export type ModelDiscoveryResult = {
  provider: ProviderKind
  endpoint: string
  status: number
  models: DiscoveredModel[]
  checked_at: string
}

export type ModelForm = {
  id: string
  name: string
  provider: ProviderKind
  baseUrl: string
  model: string
  apiKey: string
  contextWindow: number
  maxTokens: number
  reasoningLevels: ReasoningEffort[]
  enabled: boolean
  isDefault: boolean
}

export function modelFormFromSummary(model: ModelSummary): ModelForm {
  const allowed = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const levels = model.reasoning_levels.filter((level): level is ReasoningEffort => allowed.includes(level))
  return { id: model.id, name: model.name, provider: model.provider, baseUrl: model.base_url, model: model.model, apiKey: '', contextWindow: model.context_window, maxTokens: model.max_tokens, reasoningLevels: levels.length ? levels : ['none'], enabled: model.enabled, isDefault: model.is_default }
}

export type McpSummary = {
  id: string
  name: string
  command: string
  enabled: boolean
  connected: boolean
  tool_count: number
  last_error: string | null
  transport: string
  url: string | null
  last_checked: string | null
}

export type McpForm = {
  id: string
  name: string
  command: string
  args: string
  transport: 'stdio' | 'http'
  url: string
  authToken: string
}

export type SkillSummary = {
  id: string
  name: string
  description: string
  enabled: boolean
  scope: string
  path: string | null
  content_available: boolean
}

export type CommandSummary = {
  command: string
  label: string
  detail: string
  category: string
  supports_args: boolean
}

export type ToolSummary = {
  qualified_name: string
  server_id: string
  name: string
  description: string | null
  input_schema: unknown
  mutating: boolean
  source: string
  risk: string
  capabilities: string[]
  available: boolean
}

export type SessionRecord = {
  ui_turns?: Array<{ turn_index: number; text: string; attachments?: LocalAttachmentInput[]; references?: UiMentionReference[]; response_annotations?: SessionRecord['messages'][number]['response_annotations']; skills?: string[]; collaboration_mode?: 'default' | 'plan' }>
  activities?: Array<{ turn_index: number; event: AgentEvent; timeline_order?: number }>
  session_id: string
  name: string | null
  path: string
  modified_at: string | null
  message_count: number
  cwd?: string | null
  model_profile_id?: string | null
  reasoning_effort?: ReasoningEffort | null
  messages: Array<{
    role: string
    content: string
    images?: Array<{ image_url: string }>
    model_profile_id?: string | null
    reasoning_effort?: ReasoningEffort | null
    timeline_order?: number
    response_annotations?: Array<{
      id: string
      source_message_id: string
      source_message_key?: string | null
      source_turn_index?: number | null
      selected_text: string
      body: string
      created_at?: string | null
    }>
  }>
}

export type ForkSessionMode = 'before_turn' | 'through_turn'

export type ForkSessionRequest = {
  path: string
  turnIndex: number
  mode: ForkSessionMode
  name?: string
}

export type PendingChange = {
  id: string
  title: string
  description: string
  diff: string
  server_id: string
  tool_name: string
  risk: string
  status: string
}

export type TokenSummary = {
  input: number
  output: number
  cache_read: number
  cache_write: number
  total: number
}

export type SessionSummary = {
  session_id: string | null
  session_file: string | null
  name: string | null
  is_streaming: boolean
  is_compacting: boolean
  auto_compaction_enabled: boolean
  message_count: number
  context_tokens: number
  context_window: number
  context_percent: number
  tokens: TokenSummary
  compaction_count: number
  last_compacted_at: string | null
}

export type CodesysStatus = {
  detected: boolean
  executable: string | null
  supported_version: string
  profile?: string | null
  note: string
}

export type Snapshot = {
  app_version: string
  config_directory: string
  model: ModelSummary
  models: ModelSummary[]
  active_model_id: string
  mcp_servers: McpSummary[]
  project: ProjectContext
  projects: WorkspaceProject[]
  codesys: CodesysStatus
  skills: SkillSummary[]
  commands: CommandSummary[]
  tools: ToolSummary[]
  sessions: SessionRecord[]
  pending_changes: PendingChange[]
  session: SessionSummary
}

export type AgentEvent = {
  id: string
  kind: string
  title: string
  detail: string | null
  status: string
  tool: string | null
  /** 重试事件的 1-based 重试序号。 */
  retry_attempt?: number | null
  /** 本轮允许的最大重试次数。 */
  retry_max_attempts?: number | null
  /** 本次等待的实际毫秒数。 */
  retry_delay_ms?: number | null
  /** 触发重试的 HTTP 状态码。 */
  retry_status?: number | null
}

export type AgentStreamPayload = {
  type: 'request_start' | 'request_end' | 'thinking' | 'stream_start' | 'delta' | 'event' | 'result' | 'error' | 'session'
  request_id: string
  sequence: number
  phase?: 'start' | 'activity' | 'end'
  delta?: string
  event?: AgentEvent
  result?: AgentResult
  error?: string
  session?: SessionSummary
}

export type AgentStartAck = {
  request_id: string
  accepted: boolean
}

export type Diagnostic = {
  severity: string
  code: string | null
  message: string
  location: string | null
}

export type AgentResult = {
  text: string
  events: AgentEvent[]
  pending_changes: PendingChange[]
  diagnostics: Diagnostic[]
  session: SessionSummary
}

export type AgentContextBinding = {
  snapshot_id?: string | null
  project_path?: string | null
  project_directory?: string | null
  working_directory?: string | null
  project_key?: string | null
  active_object?: string | null
  active_file?: string | null
}

export type AgentRunOptions = {
  /** 本轮临时使用的模型名称，不覆盖设置中的默认模型。 */
  model?: string
  /** 本轮选择的模型 profile ID；用于绑定接口、Key、上下文长度和能力。 */
  modelProfileId?: string
  /** Pi 使用的思考级别；none 会在桥接层映射为 off。 */
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** default 允许按安全策略执行，plan 只允许读取和分析。 */
  collaborationMode?: 'default' | 'plan'
  /** 本轮重点 Skill 的 id 或路径。 */
  skills?: Array<{ name: string; path: string }>
  /** 本轮真实发送给模型的图片和文本附件。 */
  attachments?: UiAttachment[]
  /** 本轮由 @ 菜单绑定的工程文件、文件夹或历史会话。 */
  references?: UiMentionReference[]
  /** 本轮由 AI 回复选区生成的 Codex 风格批注附件。 */
  responseAnnotations?: UiResponseTextAnnotation[]
  /** 用于把实时增量绑定到当前前端轮次，避免中断后的旧输出污染下一轮。 */
  requestId?: string
  displayMessage?: string
  clientThreadId?: string
  workspacePath?: string
  sessionFile?: string
  /** 本轮进程级通知流的即时消息处理器。 */
  onEvent?: (payload: AgentStreamPayload) => void
}

export type AgentHistoryMessage = {
  role: string
  content: string
  images?: Array<{ image_url: string }>
  references?: UiMentionReference[]
  responseAnnotations?: UiResponseTextAnnotation[]
}

export type LocalAttachmentInput = {
  id: string
  name: string
  mime_type: string
  size: number
  kind: 'image' | 'text' | 'file' | string
  data_base64?: string
  image_url?: string
  text_content?: string
  error?: string
}

export type ComposerMentionSuggestion = {
  id: string
  kind: UiMentionKind
  path: string
  label: string
  description: string | null
  source: string
  readable: boolean
  sessionId?: string | null
  selectedText?: string | null
}

const EMPTY_TOKEN_SUMMARY: TokenSummary = { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0 }

export const EMPTY_PROJECT: ProjectContext = {
  path: null,
  source_root: null,
  project_directory: null,
  working_directory: null,
  snapshot_id: null,
  project_key: null,
  name: null,
  version: null,
  exists: false,
  extension: null,
  file_count: 0,
  pou_count: 0,
  source_files: [],
  scan_status: 'not_scanned',
  scan_message: null,
  active_editor_available: false,
  active_object: null,
  active_object_guid: null,
  active_file: null,
  active_file_relative: null,
  active_text: null,
  selected_text: null,
  selection_start: 0,
  selection_length: 0,
  active_text_truncated: false,
}

export const EMPTY_SNAPSHOT: Snapshot = {
  app_version: '0.1.0',
  config_directory: '',
  model: {
    id: 'model-default',
    name: 'GPT-5',
    provider: 'responses',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-5',
    configured: false,
    api_key_configured: false,
    context_window: 128000,
    max_tokens: 4096,
    reasoning_levels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    enabled: true,
    is_default: true,
    last_error: null,
    last_checked_at: null,
    connection_status: 'unchecked',
  },
  models: [],
  active_model_id: 'model-default',
  mcp_servers: [],
  project: EMPTY_PROJECT,
  projects: [],
  codesys: { detected: false, executable: null, supported_version: 'CODESYS 3.5', profile: null, note: '等待桌面运行时检测' },
  skills: [],
  commands: [],
  tools: [],
  sessions: [],
  pending_changes: [],
  session: {
    session_id: null,
    session_file: null,
    name: null,
    is_streaming: false,
    is_compacting: false,
    auto_compaction_enabled: true,
    message_count: 0,
    context_tokens: 0,
    context_window: 0,
    context_percent: 0,
    tokens: EMPTY_TOKEN_SUMMARY,
    compaction_count: 0,
    last_compacted_at: null,
  },
}

export const getSnapshot = () => invoke<Snapshot>('get_snapshot')
export type ModelSettingsSnapshot = Pick<Snapshot, 'models' | 'model' | 'active_model_id' | 'config_directory'>
export const getModelSettings = () => invoke<ModelSettingsSnapshot>('get_model_settings')
export const selectProject = (path: string) => invoke<ProjectContext>('select_project', { path })
export const pickProjectFolder = () => invoke<string | null>('pick_project_folder')
export const listProjects = () => invoke<WorkspaceProject[]>('list_projects')
export const removeProject = (id: string) => invoke<WorkspaceProject[]>('remove_project', { id })
export const scanProject = () => invoke<ProjectContext>('scan_project')
export const syncCurrentProject = () => invoke<ProjectContext>('sync_current_project')
export const listSessions = () => invoke<SessionRecord[]>('list_sessions')
export const resumeSession = (path: string) => invoke<SessionRecord>('resume_session', { path })
export const forkSession = (request: ForkSessionRequest) => invoke<SessionRecord>('fork_session', {
  request: {
    path: request.path,
    turn_index: request.turnIndex,
    mode: request.mode,
    name: request.name,
  },
})
export const startNewSession = () => invoke<SessionSummary>('start_new_session')
export const renameSession = (name: string, path?: string) => invoke<SessionSummary>('rename_session', { name, path })
export const deleteSession = (path: string) => invoke<SessionRecord[]>('delete_session', { path })
export const getSkillContent = (id: string) => invoke<string>('get_skill_content', { id })
export const compileProject = () => invoke<{ content: unknown[]; is_error: boolean }>('compile_project')
export const approveChange = async (id: string, onEvent?: (event: AgentEvent) => void) => {
  const stop = await listen<AgentStreamPayload>('agent-stream', ({ payload }) => {
    if (payload.request_id === `approval-${id}` && payload.event) onEvent?.(payload.event)
  })
  try { return await invoke<{ content: unknown[]; is_error: boolean }>('approve_change', { id }) } finally { stop() }
}
export const rejectChange = (id: string) => invoke<void>('reject_change', { id })
export const listMcpTools = () => invoke<ToolSummary[]>('list_mcp_tools')
/** 读取资源管理器复制到剪贴板的本地文件；失败时由输入框恢复为普通文本粘贴。 */
export const readLocalAttachmentFile = (path: string) => invoke<LocalAttachmentInput>('read_local_attachment_file', { path })
export const searchComposerMentions = (cwd: string, query: string, limit = 24) => invoke<ComposerMentionSuggestion[]>('search_composer_mentions', {
  cwd,
  query,
  limit,
})

function modelConfigPayload(form: ModelForm) {
  return {
    id: form.id,
    name: form.name,
    provider: form.provider,
    base_url: form.baseUrl,
    model: form.model,
    api_key: form.apiKey.trim() || null,
    max_tokens: form.maxTokens,
    context_window: form.contextWindow,
    reasoning_levels: form.reasoningLevels,
    enabled: form.enabled,
    is_default: form.isDefault,
  }
}

export const saveModel = (form: ModelForm) => invoke<ModelSummary>('configure_model', { config: modelConfigPayload(form) })
export const importModels = (form: ModelForm, modelIds: string[]) => invoke<ModelSummary[]>('import_models', { config: modelConfigPayload(form), modelIds })

export const discoverModels = (form: ModelForm) => invoke<ModelDiscoveryResult>('discover_models', {
  config: {
    id: form.id,
    name: form.name,
    provider: form.provider,
    base_url: form.baseUrl,
    model: form.model.trim(),
    api_key: form.apiKey.trim() || null,
    max_tokens: form.maxTokens,
    context_window: form.contextWindow,
    reasoning_levels: form.reasoningLevels,
    enabled: form.enabled,
    is_default: form.isDefault,
  },
})

export const setActiveModel = (id: string) => invoke<ModelSummary>('set_active_model', { id })
export const setModelEnabled = (id: string, enabled: boolean) => invoke<ModelSummary[]>('set_model_enabled', { id, enabled })
export const duplicateModel = (id: string) => invoke<ModelSummary>('duplicate_model', { id })
export const deleteModel = (id: string) => invoke<ModelSummary[]>('delete_model', { id })

export const saveMcp = (form: McpForm) => invoke<McpSummary[]>('configure_mcp', {
  request: {
    servers: [{
      id: form.id.trim(),
      name: form.name.trim(),
      command: form.command.trim(),
      args: form.args.split(/\s+/u).map((item) => item.trim()).filter(Boolean),
      env: form.authToken.trim() ? { MCP_AUTH_TOKEN: form.authToken.trim() } : {},
      enabled: true,
      transport: form.transport,
      url: form.url.trim() || null,
    }],
  },
})

export const runAgent = async (
  message: string,
  history: AgentHistoryMessage[],
  context: AgentContextBinding,
  options: AgentRunOptions = {},
) => {
  // 遵循 Codex app-server / DeepSeekHarness 的控制面与事件面分离：invoke 只负责
  // 快速确认“已接收”，后台任务通过独立通知流持续发送 lifecycle、delta 和终态。
  const requestId = options.requestId?.trim() || globalThis.crypto?.randomUUID?.() || `request-${Date.now()}`
  let completionReject: (error: Error) => void = () => undefined
  let completionResolve: (result: AgentResult) => void = () => undefined
  let settled = false
  let lastSequence = 0
  let stopGlobalStream: UnlistenFn | undefined
  const processPayload = (payload: AgentStreamPayload): void => {
    try {
      options.onEvent?.(payload)
    } catch (error) {
      completionReject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    if (payload.type === 'result' && payload.result) completionResolve(payload.result)
    if (payload.type === 'error') completionReject(new Error(payload.error || 'Agent 任务未完成'))
  }
  const handlePayload = (payload: AgentStreamPayload): void => {
    if (payload.request_id !== requestId || !Number.isSafeInteger(payload.sequence) || payload.sequence <= lastSequence) return
    lastSequence = payload.sequence
    processPayload(payload)
  }
  const completion = new Promise<AgentResult>((resolve, reject) => {
    completionResolve = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    completionReject = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
  })
  // 先注册进程级通知流，再发控制请求；这与 Codex app-server 的常驻 stdout
  // 通知订阅一致，控制请求本身不会占住事件流。
  try {
    stopGlobalStream = await listen<AgentStreamPayload>('agent-stream', (event) => handlePayload(event.payload))
  } catch (error) {
    throw new Error(`无法订阅 Agent 实时事件流：${error instanceof Error ? error.message : String(error)}`)
  }
  const startPromise = invoke<AgentStartAck>('run_agent', {
    request: {
      message,
      display_message: options.displayMessage,
      history,
      codesys_context: context,
      model: options.model?.trim() || undefined,
      model_profile_id: options.modelProfileId?.trim() || undefined,
      reasoning_effort: options.reasoningEffort || undefined,
      collaboration_mode: options.collaborationMode || undefined,
      skills: options.skills?.map((skill) => skill.path).filter(Boolean) || [],
      attachments: options.attachments?.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mime_type: attachment.mimeType,
        size: attachment.size,
        kind: attachment.kind,
        data_base64: attachment.dataBase64,
        image_url: attachment.kind === 'image' && attachment.dataBase64
          ? `data:${attachment.mimeType};base64,${attachment.dataBase64}`
          : undefined,
        text_content: attachment.textContent,
        error: attachment.error,
      })) || [],
      references: options.references?.map((reference) => ({
        id: reference.id,
        kind: reference.kind,
        path: reference.path,
        label: reference.label,
        source: reference.source,
        readable: reference.readable,
        mention: reference.mention,
        sessionId: reference.sessionId,
        selectedText: reference.selectedText,
      })) || [],
      response_annotations: options.responseAnnotations?.map((annotation) => ({
        id: annotation.id,
        source_message_id: annotation.sourceMessageId,
        source_message_key: annotation.sourceMessageKey,
        source_turn_index: annotation.sourceTurnIndex,
        selected_text: annotation.selectedText,
        body: annotation.body,
        created_at: annotation.createdAt,
      })) || [],
      request_id: requestId,
      client_thread_id: options.clientThreadId,
      workspace_path: options.workspacePath,
      session_file: options.sessionFile,
    },
  })
  try {
    const [accepted, result] = await Promise.all([startPromise, completion])
    if (!accepted.accepted || accepted.request_id !== requestId) {
      throw new Error('Agent 任务没有建立有效的实时事件流')
    }
    return result
  } catch (error) {
    completionReject(error instanceof Error ? error : new Error(String(error)))
    throw error
  } finally {
    stopGlobalStream?.()
  }
}

/** 请求桌面运行时取消当前 Agent 轮次；不会触碰工程文件或已提交的审批动作。 */
export const abortAgent = (requestId?: string) => invoke<{ aborted: boolean }>('abort_agent', { requestId })
export const steerAgent = (requestId: string, threadId: string, inputId: string, payload: { text: string; attachments: UiAttachment[]; references: UiMentionReference[]; responseAnnotations: UiResponseTextAnnotation[]; skills: Array<{ path: string }> }) => invoke<{ accepted: boolean }>('steer_agent', {
  requestId,
  input: {
    request_id: inputId, client_thread_id: threadId, message: payload.text,
    attachments: payload.attachments.map((item) => ({ id: item.id, name: item.name, mime_type: item.mimeType, size: item.size, kind: item.kind, data_base64: item.dataBase64, text_content: item.textContent, error: item.error })),
    references: payload.references,
    response_annotations: payload.responseAnnotations.map((item) => ({ id: item.id, source_message_id: item.sourceMessageId, source_message_key: item.sourceMessageKey, source_turn_index: item.sourceTurnIndex, selected_text: item.selectedText, body: item.body, created_at: item.createdAt })),
    skills: payload.skills.map((item) => item.path),
  },
})
export const startTemporaryWorkspace = () => invoke<ProjectContext>('start_temporary_workspace')

export const compactContext = (instructions: string, context: AgentContextBinding) => invoke<AgentResult>('compact_context', {
  instructions,
  codesys_context: context,
})
