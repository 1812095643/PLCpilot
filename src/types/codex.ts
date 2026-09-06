/** Agent 思考级别，保持与 Pi 运行时的配置契约一致。 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/** PLC 工作台只保留执行和计划两种协作模式。 */
export type CollaborationModeKind = 'default' | 'plan'

export type CollaborationModeOption = {
  value: CollaborationModeKind
  label: string
}

export type CommandExecutionData = {
  command: string
  /** 原始工具名，用于区分终端命令与 read/grep/MCP 等 Agent 工具。 */
  tool?: string | null
  /** 后端活动分类；只用于图标和展示，不参与工具执行。 */
  kind?: string
  cwd: string | null
  status: 'inProgress' | 'completed' | 'failed' | 'declined' | 'interrupted' | 'waiting'
  aggregatedOutput: string
  exitCode: number | null
}

export type UiFileChangeOperation = 'add' | 'delete' | 'update'
export type UiFileChangeStatus = 'inProgress' | 'completed' | 'failed' | 'declined'

export type UiFileChange = {
  path: string
  operation: UiFileChangeOperation
  movedToPath?: string | null
  diff: string
  addedLineCount: number
  removedLineCount: number
}

export type UiPlanStepStatus = 'pending' | 'inProgress' | 'completed'

export type UiPlanStep = {
  step: string
  status: UiPlanStepStatus
}

export type UiPlanData = {
  explanation?: string
  steps: UiPlanStep[]
  isStreaming?: boolean
}

export type UiAttachmentKind = 'image' | 'text' | 'file'
export type UiAttachmentStatus = 'reading' | 'ready' | 'error'

export type UiAttachment = {
  id: string
  name: string
  mimeType: string
  size: number
  kind: UiAttachmentKind
  status: UiAttachmentStatus
  error?: string
  dataBase64?: string
  textContent?: string
  previewUrl?: string
}

export type UiMentionKind = 'file' | 'directory' | 'active_file' | 'session'

export type UiMentionReference = {
  id: string
  kind: UiMentionKind
  path: string
  label: string
  source: string
  readable: boolean
  mention: string
  sessionId?: string | null
  selectedText?: string | null
}

/**
 * 回复选区批注。
 *
 * 批注不是消息下方的独立评论，而是指向某条 AI 回复的结构化上下文，
 * 会在下一次发送时随 Composer 一起交给 Agent。sourceMessageKey 用于
 * 会话恢复后在消息 ID 变化时重新绑定来源，sourceTurnIndex 是兜底定位。
 */
export type UiResponseTextAnnotation = {
  id: string
  sourceMessageId: string
  sourceMessageKey?: string
  sourceTurnIndex?: number
  selectedText: string
  body: string
  createdAt: string
}

/**
 * 可恢复的失败轮次请求参数。
 *
 * 失败消息只保存本轮用户输入及其实际配置，手动重试时从失败轮次之前
 * 的会话分支重新发送，避免把失败用户消息或已完成工具再次写入上下文。
 */
export type UiRetryPayload = {
  text: string
  modelProfileId: string
  model: string
  reasoningEffort: ReasoningEffort
  collaborationMode: CollaborationModeKind
  skills: Array<{ name: string; path: string }>
  attachments: UiAttachment[]
  references: UiMentionReference[]
  responseAnnotations: UiResponseTextAnnotation[]
}

export type UiMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  skills?: Array<{ name: string; path: string }>
  attachments?: UiAttachment[]
  references?: UiMentionReference[]
  fileChanges?: UiFileChange[]
  fileChangeStatus?: UiFileChangeStatus
  messageType?: string
  commandExecution?: CommandExecutionData
  plan?: UiPlanData
  turnId?: string
  turnIndex?: number
  /** 仅由本地会话恢复/分支使用的稳定消息序号，不参与 Agent 提示内容。 */
  sessionMessageIndex?: number
  /** Pi 原始用户轮次；null 表示本地命令或尚未进入 Pi 的请求。 */
  sessionTurnIndex?: number | null
  /** 发送该用户消息时选择的模型 profile。 */
  modelProfileId?: string
  /** 发送该用户消息时使用的模型 ID。 */
  model?: string
  /** 发送该用户消息时使用的思考等级。 */
  reasoningEffort?: ReasoningEffort
  /** 发送该用户消息时使用的协作模式。 */
  collaborationMode?: CollaborationModeKind
  /** 用于在会话恢复后重新绑定本地评论。 */
  messageKey?: string
  /** Codex 风格的 AI 回复选区批注标记。 */
  responseAnnotations?: UiResponseTextAnnotation[]
  /** 活动汇总消息引用的后台事件消息 ID；用于三层时间线折叠。 */
  activityEventIds?: string[]
  /** 本轮后台活动的实际耗时，单位为毫秒。 */
  activityDurationMs?: number
  /** 失败轮次的原始请求参数，仅 turnError 消息使用。 */
  retryPayload?: UiRetryPayload
}

export type UiLiveOverlay = {
  activityLabel: string
  activityDetails: string[]
  reasoningText: string
  errorText: string
  status?: 'working' | 'streaming' | 'reconnecting' | 'error'
}

export type UiTokenUsageBreakdown = {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

export type UiThreadTokenUsage = {
  total: UiTokenUsageBreakdown
  last: UiTokenUsageBreakdown
  modelContextWindow: number | null
  currentContextTokens: number
  remainingContextTokens: number | null
  remainingContextPercent: number | null
}
