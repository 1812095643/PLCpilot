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
  cwd: string | null
  status: 'inProgress' | 'completed' | 'failed' | 'declined' | 'interrupted'
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
}

export type UiLiveOverlay = {
  activityLabel: string
  activityDetails: string[]
  reasoningText: string
  errorText: string
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
