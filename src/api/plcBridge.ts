import { invoke } from '@tauri-apps/api/core'

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

export type ModelSummary = {
  provider: ProviderKind
  base_url: string
  model: string
  configured: boolean
}

export type ModelForm = {
  provider: ProviderKind
  baseUrl: string
  model: string
  apiKey: string
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
}

export type SessionRecord = {
  session_id: string
  name: string | null
  path: string
  modified_at: string | null
  message_count: number
  messages: Array<{ role: string; content: string }>
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
  note: string
}

export type Snapshot = {
  app_version: string
  model: ModelSummary
  mcp_servers: McpSummary[]
  project: ProjectContext
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
  /** Pi 使用的思考级别；none 会在桥接层映射为 off。 */
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  /** default 允许按安全策略执行，plan 只允许读取和分析。 */
  collaborationMode?: 'default' | 'plan'
  /** 本轮重点 Skill 的 id 或路径。 */
  skills?: Array<{ name: string; path: string }>
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
  model: { provider: 'responses', base_url: 'https://api.openai.com/v1', model: 'gpt-5', configured: false },
  mcp_servers: [],
  project: EMPTY_PROJECT,
  codesys: { detected: false, executable: null, supported_version: 'CODESYS 3.5.22', note: '等待桌面运行时检测' },
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
export const selectProject = (path: string) => invoke<ProjectContext>('select_project', { path })
export const scanProject = () => invoke<ProjectContext>('scan_project')
export const syncCurrentProject = () => invoke<ProjectContext>('sync_current_project')
export const listSessions = () => invoke<SessionRecord[]>('list_sessions')
export const resumeSession = (path: string) => invoke<SessionRecord>('resume_session', { path })
export const getSkillContent = (id: string) => invoke<string>('get_skill_content', { id })
export const compileProject = () => invoke<{ content: unknown[]; is_error: boolean }>('compile_project')
export const approveChange = (id: string) => invoke<unknown>('approve_change', { id })
export const rejectChange = (id: string) => invoke<void>('reject_change', { id })
export const listMcpTools = () => invoke<ToolSummary[]>('list_mcp_tools')

export const saveModel = (form: ModelForm) => invoke<ModelSummary>('configure_model', {
  config: {
    provider: form.provider,
    base_url: form.baseUrl,
    model: form.model,
    api_key: form.apiKey.trim() || null,
    max_tokens: 4096,
  },
})

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

export const runAgent = (
  message: string,
  history: Array<{ role: string; content: string }>,
  context: AgentContextBinding,
  options: AgentRunOptions = {},
) => invoke<AgentResult>('run_agent', {
  request: {
    message,
    history,
    codesys_context: context,
    model: options.model?.trim() || undefined,
    reasoning_effort: options.reasoningEffort || undefined,
    collaboration_mode: options.collaborationMode || undefined,
    skills: options.skills?.map((skill) => skill.path).filter(Boolean) || [],
  },
})

/** 请求桌面运行时取消当前 Agent 轮次；不会触碰工程文件或已提交的审批动作。 */
export const abortAgent = () => invoke<{ aborted: boolean }>('abort_agent')

export const compactContext = (instructions: string, context: AgentContextBinding) => invoke<AgentResult>('compact_context', {
  instructions,
  codesys_context: context,
})
