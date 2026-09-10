<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import type {
  CollaborationModeKind,
  CollaborationModeOption,
  ReasoningEffort,
  UiMentionReference,
  UiResponseTextAnnotation,
  UiThreadTokenUsage,
} from '../../types/codex'
import type { ComposerAttachment, ComposerAttachmentDraft } from '../../composables/useComposerAttachments'
import { useComposerAttachments } from '../../composables/useComposerAttachments'
import { useComposerDraftStorage } from '../../composables/useComposerDraftStorage'
import { readLocalAttachmentFile, searchComposerMentions, type CommandSummary, type ComposerMentionSuggestion } from '../../api/plcBridge'
import {
  completeSlashCommand,
  completeSlashCommandPreservingDraftTail,
  filterSlashCommands,
  getSlashCommandPopupState,
  getSlashCommandToken,
} from '../../utils/slashCommands'
import ComposerCommandPopup from './ComposerCommandPopup.vue'
import ComposerSearchDropdown from './ComposerSearchDropdown.vue'
import ComposerAttachmentStrip from './ComposerAttachmentStrip.vue'
import ComposerResponseAnnotationStrip from './ComposerResponseAnnotationStrip.vue'
import ComposerMentionPopup from './ComposerMentionPopup.vue'
import ComposerModelPicker from './ComposerModelPicker.vue'
import ComposerAccessPicker from './ComposerAccessPicker.vue'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
import IconTablerBolt from '../icons/IconTablerBolt.vue'
import IconTablerPaperclip from '../icons/IconTablerPaperclip.vue'
import IconTablerPlayerStopFilled from '../icons/IconTablerPlayerStopFilled.vue'

type SkillItem = {
  name: string
  displayName?: string
  description: string
  path: string
  scope?: string
  enabled?: boolean
}

export type ComposerDraftPayload = {
  text: string
  skills: Array<{ name: string; path: string }>
  attachments?: ComposerAttachmentDraft[]
  references?: UiMentionReference[]
  responseAnnotations?: UiResponseTextAnnotation[]
}

export type SubmitPayload = {
  text: string
  skills: Array<{ name: string; path: string }>
  attachments: ComposerAttachment[]
  references: UiMentionReference[]
  responseAnnotations: UiResponseTextAnnotation[]
  mode: 'steer' | 'queue'
  /** 重试或恢复时固定本轮实际使用的配置；普通 Composer 提交不填写。 */
  modelProfileId?: string
  model?: string
  reasoningEffort?: ReasoningEffort
  collaborationMode?: CollaborationModeKind
}

export type ComposerModelOption = {
  id: string
  name: string
  model: string
}

export type ThreadComposerExposed = {
  hydrateDraft: (payload: ComposerDraftPayload) => void
  appendTextToDraft: (text: string) => void
  hasUnsavedDraft: () => boolean
  readDraft: () => ComposerDraftPayload
}

const props = withDefaults(defineProps<{
  activeThreadId: string
  cwd?: string
  collaborationModes?: CollaborationModeOption[]
  selectedCollaborationMode: CollaborationModeKind
  models: ComposerModelOption[]
  /** 当前选择的是 profile ID，不是可能重复的供应商模型 ID。 */
  selectedModel: string
  selectedReasoningEffort: ReasoningEffort | ''
  reasoningEfforts?: ReasoningEffort[]
  commands?: CommandSummary[]
  skills?: SkillItem[]
  threadTokenUsage?: UiThreadTokenUsage | null
  isTurnInProgress?: boolean
  accessMode?: 'approval' | 'full'
  accessModeDisabled?: boolean
  disabled?: boolean
  responseAnnotations?: UiResponseTextAnnotation[]
  sendWithEnter?: boolean
  inProgressSubmitMode?: 'steer' | 'queue'
}>(), {
  cwd: '',
  collaborationModes: () => [
    { value: 'default', label: '执行' },
    { value: 'plan', label: '计划' },
  ],
  skills: () => [],
  responseAnnotations: () => [],
  threadTokenUsage: null,
  isTurnInProgress: false,
  accessMode: 'approval',
  accessModeDisabled: false,
  disabled: false,
  sendWithEnter: true,
  inProgressSubmitMode: 'steer',
  commands: () => [],
  reasoningEfforts: () => ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
})

const emit = defineEmits<{
  submit: [payload: SubmitPayload]
  interrupt: []
  'update:access-mode': [mode: 'approval' | 'full']
  'update:selected-collaboration-mode': [mode: CollaborationModeKind]
  'update:selected-model': [modelId: string]
  'update:selected-reasoning-effort': [effort: ReasoningEffort | '']
  'update:response-annotations': [annotations: UiResponseTextAnnotation[]]
  'edit-response-annotation': [annotation: UiResponseTextAnnotation]
  'remove-response-annotation': [id: string]
}>()

const DRAFT_STORAGE_PREFIX = 'plc-pilot.thread-draft.v2.'
const draft = shallowRef('')
const selectedSkills = shallowRef<SkillItem[]>([])
const draftResponseAnnotations = shallowRef<UiResponseTextAnnotation[]>([])
const activeInProgressMode = shallowRef<'steer' | 'queue'>(props.inProgressSubmitMode)
const isFileMentionOpen = shallowRef(false)
const mentionQuery = shallowRef('')
const mentionStartIndex = shallowRef<number | null>(null)
const mentionHighlightedIndex = shallowRef(0)
const fileMentionSuggestions = shallowRef<ComposerMentionSuggestion[]>([])
const mentionReferences = shallowRef<UiMentionReference[]>([])
const isSlashCommandOpen = shallowRef(false)
const slashCommandQuery = shallowRef('')
const slashCommandToken = shallowRef('')
const slashHighlightedIndex = shallowRef(0)
const dismissedSlashCommandToken = shallowRef<string | null>(null)

let lastActiveThreadId = ''
const draftStorage = useComposerDraftStorage()
let restoringDraft = false
let mentionSearchTimer: ReturnType<typeof setTimeout> | null = null
let mentionSearchToken = 0

const inputRef = shallowRef<HTMLTextAreaElement | null>(null)
const composerRootRef = shallowRef<HTMLElement | null>(null)
const fileInputRef = shallowRef<HTMLInputElement | null>(null)
const isDragActive = shallowRef(false)
const {
  attachments,
  isReading: isAttachmentReading,
  hasReadyAttachment,
  addFiles,
  addPreparedAttachment,
  removeAttachment,
  serializeAttachments,
  restoreAttachments,
} = useComposerAttachments()

const skillOptions = computed(() => props.skills.map((skill) => ({
  value: skill.path,
  label: skill.displayName || skill.name,
  description: skill.description,
  badge: skill.scope === 'builtin' ? '内' : '项',
  badgeLabel: skill.scope === 'builtin' ? '内置' : '工程',
  badgeTone: skill.scope === 'builtin' ? 'system' as const : 'repo' as const,
}))
)

const selectedSkillPaths = computed(() => selectedSkills.value.map((skill) => skill.path))
const isInteractionDisabled = computed(() => props.disabled || !props.activeThreadId.trim())
const isPlanMode = computed(() => props.selectedCollaborationMode === 'plan' || /^\/plan(?:\s|$)/iu.test(draft.value.trim()))
const placeholder = computed(() => isInteractionDisabled.value
  ? '先选择一个本地 CODESYS 工程'
  : '描述要检查、修改或诊断的 PLC 任务…')
const hasUnsavedDraft = computed(() => draft.value.trim().length > 0 || selectedSkills.value.length > 0 || attachments.value.length > 0 || mentionReferences.value.length > 0 || draftResponseAnnotations.value.length > 0)
const canSubmit = computed(() => !isInteractionDisabled.value && !isAttachmentReading.value && (draft.value.trim().length > 0 || hasReadyAttachment.value || draftResponseAnnotations.value.length > 0))

const contextView = computed(() => {
  const usage = props.threadTokenUsage
  if (!usage) return { percent: null, tone: 'quiet' as const }
  let remaining = usage.remainingContextPercent
  if (remaining === null && usage.modelContextWindow && usage.modelContextWindow > 0) {
    remaining = Math.max(0, Math.round((1 - usage.currentContextTokens / usage.modelContextWindow) * 100))
  }
  if (remaining === null || !Number.isFinite(remaining)) return { percent: null, tone: 'quiet' as const }
  const tone = remaining <= 15 ? 'danger' : remaining <= 35 ? 'warning' : 'healthy'
  const percent = Math.max(0, Math.min(100, Math.round(remaining)))
  return { percent, tone }
})

const contextRingStyle = computed(() => ({ '--context-percent': `${contextView.value.percent ?? 0}%` }))

const contextTitle = computed(() => {
  const usage = props.threadTokenUsage
  if (!usage?.modelContextWindow) return '发送后会显示上下文占用'
  return `当前 ${usage.currentContextTokens.toLocaleString()} / ${usage.modelContextWindow.toLocaleString()} tokens`
})

const contextTooltip = computed(() => {
  const usage = props.threadTokenUsage
  const percent = contextView.value.percent
  if (!usage?.modelContextWindow || percent === null) return '上下文用量暂不可用'
  return `剩余 ${percent}% · ${usage.currentContextTokens.toLocaleString()} / ${usage.modelContextWindow.toLocaleString()} tokens`
})

const mentionVisible = computed(() => isFileMentionOpen.value && fileMentionSuggestions.value.length > 0)
const filteredSlashCommands = computed(() => filterSlashCommands(props.commands, slashCommandQuery.value))
const activeSlashCommandId = computed(() => {
  const command = filteredSlashCommands.value[slashHighlightedIndex.value]
  return command ? `plc-slash-command-${command.command.replace(/[^a-zA-Z0-9_-]/gu, '-')}` : undefined
})
const activeMentionId = computed(() => {
  const suggestion = fileMentionSuggestions.value[mentionHighlightedIndex.value]
  return suggestion ? `plc-mention-${suggestion.id.replace(/[^a-zA-Z0-9_-]/gu, '-')}` : undefined
})

function getDraftStorageKey(threadId: string): string {
  return `${DRAFT_STORAGE_PREFIX}${threadId.trim()}`
}

function emptyPayload(): ComposerDraftPayload {
  return { text: '', skills: [], attachments: [], references: [], responseAnnotations: [] }
}

function validResponseAnnotations(value: unknown): UiResponseTextAnnotation[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((annotation): annotation is UiResponseTextAnnotation => Boolean(annotation)
      && typeof annotation === 'object'
      && typeof (annotation as UiResponseTextAnnotation).id === 'string'
      && typeof (annotation as UiResponseTextAnnotation).sourceMessageId === 'string'
      && typeof (annotation as UiResponseTextAnnotation).selectedText === 'string'
      && typeof (annotation as UiResponseTextAnnotation).body === 'string'
      && typeof (annotation as UiResponseTextAnnotation).createdAt === 'string'
      && (annotation as UiResponseTextAnnotation).selectedText.trim().length > 0
      && (annotation as UiResponseTextAnnotation).body.trim().length > 0)
    .slice(0, 32)
}

function validMentionReferences(value: unknown): UiMentionReference[] {
  if (!Array.isArray(value)) return []
  return value.filter((reference): reference is UiMentionReference => Boolean(reference)
    && typeof reference === 'object'
    && typeof (reference as UiMentionReference).id === 'string'
    && typeof (reference as UiMentionReference).kind === 'string'
    && typeof (reference as UiMentionReference).path === 'string'
    && typeof (reference as UiMentionReference).label === 'string'
    && typeof (reference as UiMentionReference).source === 'string'
    && typeof (reference as UiMentionReference).mention === 'string')
    .slice(0, 16)
}

function pruneMentionReferences(): void {
  const currentText = draft.value
  mentionReferences.value = mentionReferences.value.filter((reference) => {
    const marker = reference.mention.trim()
    return marker.length > 0 && currentText.includes(marker)
  })
}

async function readDraft(threadId: string): Promise<ComposerDraftPayload | null> {
  if (typeof window === 'undefined' || !threadId.trim()) return null
  try {
    const value = await draftStorage.read(threadId)
    if (!value) return null
    return {
      text: typeof value.text === 'string' ? value.text : '',
      skills: Array.isArray(value.skills)
        ? value.skills.filter((skill): skill is { name: string; path: string } => Boolean(skill)
          && typeof skill.name === 'string' && typeof skill.path === 'string')
        : [],
      attachments: Array.isArray(value.attachments)
        ? value.attachments as ComposerAttachmentDraft[]
        : [],
      references: validMentionReferences(value.references),
      responseAnnotations: validResponseAnnotations(value.responseAnnotations),
    }
  } catch {
    return null
  }
}

function persistDraft(threadId: string): void {
  if (typeof window === 'undefined' || !threadId.trim()) return
  const payload: Required<ComposerDraftPayload> = {
    text: draft.value,
    skills: selectedSkills.value.map((skill) => ({ name: skill.name, path: skill.path })),
    attachments: serializeAttachments(),
    references: mentionReferences.value,
    responseAnnotations: draftResponseAnnotations.value,
  }
  draftStorage.save(threadId, payload)
}

function replaceDraft(payload: ComposerDraftPayload): void {
  draft.value = payload.text
  selectedSkills.value = payload.skills.map((item) => props.skills.find((skill) => skill.path === item.path)
    ?? { name: item.name, path: item.path, description: '' })
  restoreAttachments(payload.attachments)
  mentionReferences.value = validMentionReferences(payload.references)
  draftResponseAnnotations.value = validResponseAnnotations(payload.responseAnnotations)
  emit('update:response-annotations', draftResponseAnnotations.value)
  pruneMentionReferences()
  closeFileMention()
  resetSlashCommandPopup()
  void nextTick(syncComposerPopups)
}

function clearDraft(): void {
  replaceDraft(emptyPayload())
}

function hydrateDraft(payload: ComposerDraftPayload): void {
  replaceDraft(payload)
  void nextTick(() => inputRef.value?.focus())
}

function appendTextToDraft(text: string): void {
  const value = text.trim()
  if (!value) return
  draft.value = draft.value.trim() ? `${draft.value.trimEnd()}\n${value}` : value
  void nextTick(() => {
    inputRef.value?.focus()
    syncComposerPopups()
  })
}

function submitCurrent(mode: 'steer' | 'queue' = props.isTurnInProgress ? activeInProgressMode.value : 'steer'): void {
  if (!canSubmit.value) return
  pruneMentionReferences()
  emit('submit', {
    text: draft.value.trim(),
    skills: selectedSkills.value.map((skill) => ({ name: skill.name, path: skill.path })),
    attachments: serializeAttachments().filter((attachment) => attachment.status === 'ready'),
    references: mentionReferences.value,
    responseAnnotations: draftResponseAnnotations.value,
    mode,
  })
  clearDraft()
  persistDraft(props.activeThreadId)
  void nextTick(() => inputRef.value?.focus())
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (isFileMentionOpen.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveMentionHighlight(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveMentionHighlight(-1)
      return
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && mentionVisible.value) {
      event.preventDefault()
      const item = fileMentionSuggestions.value[mentionHighlightedIndex.value]
      if (item) applyFileMention(item)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeFileMention()
      return
    }
  }
  if (handleSlashCommandKeydown(event)) return
  if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
    && props.sendWithEnter !== false) {
    event.preventDefault()
    submitCurrent()
  }
}

function onInput(): void {
  pruneMentionReferences()
  syncComposerPopups()
}

function openFilePicker(): void {
  if (isInteractionDisabled.value) return
  fileInputRef.value?.click()
}

function onFileInputChange(event: Event): void {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  addFiles(Array.from(input.files ?? []), 'file')
  input.value = ''
}

function clipboardFiles(event: ClipboardEvent): File[] {
  const files = Array.from(event.clipboardData?.files ?? [])
  if (files.length > 0) return files
  return Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item, index) => {
      const file = item.getAsFile()
      if (!file) return null
      if (typeof File !== 'undefined' && file instanceof File) return file
      return new File([file], `clipboard-${Date.now()}-${index}`, { type: file.type || 'application/octet-stream' })
    })
    .filter((file): file is File => file !== null)
}

function clipboardSpreadsheetFile(event: ClipboardEvent): File | null {
  const html = event.clipboardData?.getData('text/html') ?? ''
  if (!html || !/<table[\s>]/iu.test(html)) return null
  if (typeof DOMParser === 'undefined' || typeof File === 'undefined') return null
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const rows = Array.from(parsed.querySelectorAll('tr'))
    .map((row) => Array.from(row.querySelectorAll('th,td')).map((cell) => (cell.textContent ?? '').replace(/\s+/gu, ' ').trim()))
    .filter((row) => row.length > 0)
  if (rows.length === 0) return null
  const csv = rows.map((row) => row.map((cell) => {
    const escaped = cell.replace(/"/gu, '""')
    return /[",\n]/u.test(escaped) ? `"${escaped}"` : escaped
  }).join(',')).join('\n')
  return new File([csv], `clipboard-table-${Date.now()}.csv`, { type: 'text/csv' })
}

function clipboardFilePaths(event: ClipboardEvent): string[] {
  const uriList = event.clipboardData?.getData('text/uri-list') ?? ''
  const candidates = uriList.split(/\r?\n/u).map((value) => value.trim()).filter((value) => value && !value.startsWith('#'))
  const plainText = event.clipboardData?.getData('text/plain') ?? ''
  if (candidates.length === 0 && plainText.split(/\r?\n/u).every((value) => /^file:\/\//iu.test(value.trim()))) {
    candidates.push(...plainText.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean))
  }
  return candidates
    .filter((value) => /^file:\/\//iu.test(value))
    .map((value) => {
      try {
        return decodeURIComponent(new URL(value).pathname.replace(/^\/(?=[A-Z]:[\\/])/iu, ''))
      } catch {
        return value.replace(/^file:\/\//iu, '')
      }
    })
}

async function onPaste(event: ClipboardEvent): Promise<void> {
  const files = clipboardFiles(event)
  const spreadsheet = files.length === 0 ? clipboardSpreadsheetFile(event) : null
  const paths = files.length === 0 && !spreadsheet ? clipboardFilePaths(event) : []
  if (files.length === 0 && !spreadsheet && paths.length === 0) return
  event.preventDefault()
  if (spreadsheet || files.length > 0) {
    addFiles(spreadsheet ? [spreadsheet] : files, 'clipboard')
    return
  }
  const prepared = await Promise.all(paths.map(async (path) => {
    try {
      return await readLocalAttachmentFile(path)
    } catch {
      return null
    }
  }))
  prepared.filter((item): item is NonNullable<typeof item> => item !== null).forEach((item) => addPreparedAttachment(item, 'clipboard'))
}

function hasDraggedFiles(event: DragEvent): boolean {
  const types = Array.from(event.dataTransfer?.types ?? [])
  return types.includes('Files') || types.includes('text/uri-list')
}

function onDragOver(event: DragEvent): void {
  if (!hasDraggedFiles(event)) return
  event.preventDefault()
  isDragActive.value = true
}

function onDragLeave(event: DragEvent): void {
  if (!hasDraggedFiles(event)) return
  const root = composerRootRef.value
  if (root && event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) return
  isDragActive.value = false
}

type FileSystemEntryLike = {
  isFile: boolean
  isDirectory: boolean
  file?: (callback: (file: File) => void) => void
  createReader?: () => { readEntries: (callback: (entries: FileSystemEntryLike[]) => void) => void }
}

function readDirectoryEntries(reader: { readEntries: (callback: (entries: FileSystemEntryLike[]) => void) => void }): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve) => reader.readEntries(resolve))
}

async function filesFromDrop(event: DragEvent): Promise<File[]> {
  const directFiles = Array.from(event.dataTransfer?.files ?? [])
  const items = Array.from(event.dataTransfer?.items ?? [])
  const entries = items
    .map((item): FileSystemEntryLike | null => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntryLike => entry !== null)
  if (entries.length === 0) return directFiles
  const result: File[] = [...directFiles]
  async function visit(entry: FileSystemEntryLike): Promise<void> {
    if (entry.isFile && entry.file) {
      await new Promise<void>((resolve) => entry.file?.((file) => { result.push(file); resolve() }))
      return
    }
    if (!entry.isDirectory || !entry.createReader) return
    const reader = entry.createReader()
    while (true) {
      const batch = await readDirectoryEntries(reader)
      if (batch.length === 0) break
      for (const child of batch) await visit(child)
    }
  }
  for (const entry of entries) await visit(entry)
  return result
}

async function onDrop(event: DragEvent): Promise<void> {
  if (!hasDraggedFiles(event)) return
  event.preventDefault()
  isDragActive.value = false
  const files = await filesFromDrop(event)
  if (files.length > 0) {
    addFiles(files, 'drop')
    return
  }
  const paths = Array.from(event.dataTransfer?.getData('text/uri-list')?.split(/\r?\n/u) ?? [])
    .map((value) => value.trim())
    .filter((value) => /^file:\/\//iu.test(value))
  const prepared = await Promise.all(paths.map(async (path) => {
    try {
      const url = new URL(path)
      const normalizedPath = decodeURIComponent(url.pathname.replace(/^\/(?=[A-Z]:[\\/])/iu, ''))
      return await readLocalAttachmentFile(normalizedPath)
    } catch {
      return null
    }
  }))
  prepared.filter((item): item is NonNullable<typeof item> => item !== null).forEach((item) => addPreparedAttachment(item, 'drop'))
}

function onCursorChange(): void {
  // textarea 的光标位置会在键盘或鼠标默认行为后更新，延后同步才能按真实位置判断 token。
  void nextTick(syncComposerPopups)
}

function syncComposerPopups(): void {
  updateFileMention()
  // 与 Codex 一致：命令参数中的 @ 引用优先于斜杠命令菜单。
  if (isFileMentionOpen.value) {
    closeSlashCommandPopup()
    return
  }
  syncSlashCommandPopup()
}

function syncSlashCommandPopup(): void {
  const completeToken = getSlashCommandToken(draft.value)
  if (completeToken && dismissedSlashCommandToken.value === completeToken) {
    closeSlashCommandPopup()
    return
  }
  if (!completeToken) dismissedSlashCommandToken.value = null

  const cursor = inputRef.value?.selectionStart ?? draft.value.length
  const state = getSlashCommandPopupState(draft.value, cursor, props.commands)
  if (!state) {
    closeSlashCommandPopup()
    return
  }

  dismissedSlashCommandToken.value = null
  if (!isSlashCommandOpen.value || slashCommandQuery.value !== state.query) {
    slashHighlightedIndex.value = 0
  }
  isSlashCommandOpen.value = true
  slashCommandQuery.value = state.query
  slashCommandToken.value = state.token
}

function closeSlashCommandPopup(): void {
  isSlashCommandOpen.value = false
  slashCommandQuery.value = ''
  slashCommandToken.value = ''
  slashHighlightedIndex.value = 0
}

function dismissSlashCommandPopup(): void {
  dismissedSlashCommandToken.value = slashCommandToken.value || getSlashCommandToken(draft.value)
  closeSlashCommandPopup()
}

function resetSlashCommandPopup(): void {
  dismissedSlashCommandToken.value = null
  closeSlashCommandPopup()
}

function moveSlashCommandHighlight(delta: number): void {
  const length = filteredSlashCommands.value.length
  if (length === 0) return
  slashHighlightedIndex.value = (slashHighlightedIndex.value + delta + length) % length
}

function selectedSlashCommand(): CommandSummary | null {
  const items = filteredSlashCommands.value
  if (items.length === 0) return null
  const index = ((slashHighlightedIndex.value % items.length) + items.length) % items.length
  slashHighlightedIndex.value = index
  return items[index] ?? null
}

function focusCommandCompletion(cursor: number): void {
  void nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.setSelectionRange(cursor, cursor)
    syncComposerPopups()
  })
}

function completeSelectedSlashCommand(command: CommandSummary): boolean {
  const cursor = inputRef.value?.selectionStart ?? draft.value.length
  const preservedTail = completeSlashCommandPreservingDraftTail(draft.value, cursor, command)
  if (preservedTail !== null) {
    draft.value = preservedTail
    closeSlashCommandPopup()
    focusCommandCompletion(preservedTail.length)
    return true
  }

  const firstLine = draft.value.split('\n', 1)[0] ?? ''
  const completion = completeSlashCommand(firstLine, command)
  if (completion === null) return false
  draft.value = completion
  closeSlashCommandPopup()
  focusCommandCompletion(completion.length)
  return true
}

function executeSelectedSlashCommand(command: CommandSummary): void {
  const cursor = inputRef.value?.selectionStart ?? draft.value.length
  const preservedTail = completeSlashCommandPreservingDraftTail(draft.value, cursor, command)
  draft.value = preservedTail ?? (command.command.startsWith('/') ? command.command : `/${command.command}`)
  closeSlashCommandPopup()
  submitCurrent()
}

function onSlashCommandSelect(command: CommandSummary): void {
  executeSelectedSlashCommand(command)
}

function handleSlashCommandKeydown(event: KeyboardEvent): boolean {
  if (!isSlashCommandOpen.value || isFileMentionOpen.value) return false

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    dismissSlashCommandPopup()
    return true
  }
  if (event.key === 'ArrowUp' || (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'p')) {
    event.preventDefault()
    event.stopPropagation()
    moveSlashCommandHighlight(-1)
    return true
  }
  if (event.key === 'ArrowDown' || (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'n')) {
    event.preventDefault()
    event.stopPropagation()
    moveSlashCommandHighlight(1)
    return true
  }

  const command = selectedSlashCommand()
  if (event.key === 'Tab') {
    event.preventDefault()
    event.stopPropagation()
    if (!command) return true
    // Codex 对 /skills 的 Tab 有立即调度语义。
    if (command.command === '/skills') {
      draft.value = command.command
      closeSlashCommandPopup()
      submitCurrent()
      return true
    }
    completeSelectedSlashCommand(command)
    return true
  }
  if (event.key === '/' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault()
    event.stopPropagation()
    if (command) completeSelectedSlashCommand(command)
    return true
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
    if (!command) {
      closeSlashCommandPopup()
      return false
    }
    event.preventDefault()
    event.stopPropagation()
    executeSelectedSlashCommand(command)
    return true
  }
  return false
}

function updateFileMention(): void {
  const input = inputRef.value
  if (!input) {
    closeFileMention()
    return
  }
  const cursor = input.selectionStart ?? draft.value.length
  const beforeCursor = draft.value.slice(0, cursor)
  const match = beforeCursor.match(/(^|\s)@(?:"([^"]*)|([^\s@]*))$/u)
  if (!match) {
    closeFileMention()
    return
  }
  const token = match[0]
  mentionStartIndex.value = cursor - token.length + token.lastIndexOf('@')
  const nextQuery = match[2] ?? match[3] ?? ''
  const queryChanged = !isFileMentionOpen.value || mentionQuery.value !== nextQuery
  if (queryChanged) {
    mentionHighlightedIndex.value = 0
  }
  mentionQuery.value = nextQuery
  isFileMentionOpen.value = true
  if (queryChanged) scheduleMentionSearch(mentionQuery.value)
}

function scheduleMentionSearch(query: string): void {
  if (mentionSearchTimer) clearTimeout(mentionSearchTimer)
  const token = ++mentionSearchToken
  mentionSearchTimer = setTimeout(async () => {
    const rows = await searchComposerMentions(props.cwd?.trim() ?? '', query, 24)
    if (token !== mentionSearchToken || !isFileMentionOpen.value) return
    fileMentionSuggestions.value = rows
    mentionHighlightedIndex.value = 0
  }, 100)
}

function moveMentionHighlight(delta: number): void {
  if (fileMentionSuggestions.value.length === 0) return
  const length = fileMentionSuggestions.value.length
  mentionHighlightedIndex.value = (mentionHighlightedIndex.value + delta + length) % length
}

function applyFileMention(item: ComposerMentionSuggestion): void {
  const input = inputRef.value
  const start = mentionStartIndex.value
  if (!input || start === null) return
  const cursor = input.selectionStart ?? draft.value.length
  const path = item.path.replace(/"/gu, '\\"')
  const rawMention = item.kind === 'session'
    ? `@${item.label.replace(/\s+/gu, ' ').trim()}`
    : path.includes(' ') ? `@"${path}"` : `@${path}`
  const replacement = `${rawMention} `
  draft.value = `${draft.value.slice(0, start)}${replacement}${draft.value.slice(cursor)}`
  const reference: UiMentionReference = {
    id: item.id,
    kind: item.kind,
    path: item.path,
    label: item.label,
    source: item.source,
    readable: item.readable,
    mention: rawMention,
    sessionId: item.sessionId,
    selectedText: item.selectedText,
  }
  mentionReferences.value = [
    ...mentionReferences.value.filter((existing) => existing.id !== reference.id),
    reference,
  ].slice(-16)
  closeFileMention()
  void nextTick(() => {
    const nextCursor = start + replacement.length
    inputRef.value?.focus()
    inputRef.value?.setSelectionRange(nextCursor, nextCursor)
    syncComposerPopups()
  })
}

function closeFileMention(): void {
  isFileMentionOpen.value = false
  mentionQuery.value = ''
  mentionStartIndex.value = null
  fileMentionSuggestions.value = []
  mentionHighlightedIndex.value = 0
  mentionSearchToken += 1
}

function onSkillToggle(path: string, checked: boolean): void {
  const skill = props.skills.find((item) => item.path === path)
  if (!skill) return
  if (checked) {
    if (!selectedSkills.value.some((item) => item.path === path)) {
      selectedSkills.value = [...selectedSkills.value, skill]
    }
  } else {
    selectedSkills.value = selectedSkills.value.filter((item) => item.path !== path)
  }
}

function removeSkill(path: string): void {
  selectedSkills.value = selectedSkills.value.filter((item) => item.path !== path)
}

function removeResponseAnnotation(id: string): void {
  draftResponseAnnotations.value = draftResponseAnnotations.value.filter((annotation) => annotation.id !== id)
  emit('update:response-annotations', draftResponseAnnotations.value)
}

function editResponseAnnotation(annotation: UiResponseTextAnnotation): void {
  emit('edit-response-annotation', annotation)
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!isFileMentionOpen.value && !isSlashCommandOpen.value) return
  const root = composerRootRef.value
  const target = event.target
  if (!root || !(target instanceof Node) || root.contains(target)) return
  closeFileMention()
  closeSlashCommandPopup()
}

watch(() => props.inProgressSubmitMode, (value) => {
  activeInProgressMode.value = value
})

watch(() => props.responseAnnotations, (value) => {
  const next = validResponseAnnotations(value)
  if (JSON.stringify(next) !== JSON.stringify(draftResponseAnnotations.value)) {
    draftResponseAnnotations.value = next
  }
}, { deep: true, immediate: true })

watch(() => props.activeThreadId, async (threadId) => {
  if (lastActiveThreadId) persistDraft(lastActiveThreadId)
  lastActiveThreadId = threadId.trim()
  restoringDraft = true
  replaceDraft(emptyPayload())
  const restored = await readDraft(threadId)
  if (props.activeThreadId !== threadId) return
  if (!draft.value && attachments.value.length === 0) replaceDraft(restored ?? emptyPayload())
  await nextTick()
  restoringDraft = false
}, { immediate: true })

watch([draft, selectedSkillPaths, attachments, mentionReferences, draftResponseAnnotations], () => {
  if (!restoringDraft && lastActiveThreadId) persistDraft(lastActiveThreadId)
})

watch(() => props.commands, () => {
  void nextTick(syncComposerPopups)
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  if (mentionSearchTimer) clearTimeout(mentionSearchTimer)
  isDragActive.value = false
})

defineExpose<ThreadComposerExposed>({
  hydrateDraft,
  appendTextToDraft,
  hasUnsavedDraft: () => hasUnsavedDraft.value,
  readDraft: () => ({ text: draft.value, skills: selectedSkills.value.map(({ name, path }) => ({ name, path })), attachments: serializeAttachments(), references: [...mentionReferences.value], responseAnnotations: [...draftResponseAnnotations.value] }),
})
</script>

<template>
  <form ref="composerRootRef" class="plc-thread-composer" :class="{ 'is-drag-active': isDragActive }" @submit.prevent="submitCurrent()" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <div class="plc-composer-shell" :class="{ 'is-busy': isTurnInProgress }">
      <div v-if="selectedSkills.length > 0" class="plc-composer-chips" aria-label="已启用 Skills">
        <span v-for="skill in selectedSkills" :key="skill.path" class="plc-composer-chip">
          <IconTablerBolt aria-hidden="true" />
          <span>{{ skill.displayName || skill.name }}</span>
          <button type="button" aria-label="移除 Skill" @click="removeSkill(skill.path)">×</button>
        </span>
      </div>

      <div class="plc-composer-editor">
        <ComposerCommandPopup
          v-if="isSlashCommandOpen && !isFileMentionOpen"
          :commands="commands"
          :query="slashCommandQuery"
          :highlighted-index="slashHighlightedIndex"
          @select="onSlashCommandSelect"
          @update:highlighted-index="slashHighlightedIndex = $event"
        />
        <ComposerMentionPopup
          v-if="isFileMentionOpen"
          :suggestions="fileMentionSuggestions"
          :highlighted-index="mentionHighlightedIndex"
          @select="applyFileMention"
          @update:highlighted-index="mentionHighlightedIndex = $event"
        />

        <div v-if="draftResponseAnnotations.length > 0 || attachments.length > 0" class="plc-composer-context-row">
          <ComposerResponseAnnotationStrip
            :annotations="draftResponseAnnotations"
            @edit="editResponseAnnotation"
            @remove="removeResponseAnnotation"
          />
          <ComposerAttachmentStrip :attachments="attachments" @remove="removeAttachment" />
        </div>
        <textarea
          ref="inputRef"
          v-model="draft"
          class="plc-composer-input"
          :placeholder="placeholder"
          :disabled="isInteractionDisabled"
          :aria-expanded="isSlashCommandOpen || isFileMentionOpen ? 'true' : 'false'"
          :aria-controls="isSlashCommandOpen ? 'plc-slash-command-menu' : isFileMentionOpen ? 'plc-mention-popup' : undefined"
          :aria-activedescendant="isFileMentionOpen ? activeMentionId : activeSlashCommandId"
          aria-autocomplete="list"
          rows="3"
          @input="onInput"
          @paste="onPaste"
          @keydown="onKeydown"
          @keyup="onCursorChange"
          @select="onCursorChange"
          @click="onCursorChange"
        />
        <div class="plc-composer-hint">
          <span>Enter 发送 · Shift+Enter 换行</span>
              <span><code>@</code> 引用文件、文件夹或历史会话</span>
        </div>
      </div>

      <div class="plc-composer-toolbar">
        <div class="plc-composer-options">
          <button type="button" class="plc-composer-attach" aria-label="添加附件" title="添加图片或文件" :disabled="isInteractionDisabled" @click="openFilePicker">
            <IconTablerPaperclip aria-hidden="true" />
          </button>
          <input ref="fileInputRef" class="plc-composer-file-input" type="file" multiple accept="image/*,.c,.cc,.cpp,.css,.csv,.h,.hpp,.html,.iecst,.ini,.java,.js,.json,.log,.md,.mjs,.py,.rs,.sql,.st,.svg,.toml,.ts,.tsx,.txt,.vue,.xml,.yaml,.yml" @change="onFileInputChange" />
          <ComposerSearchDropdown
            class="plc-composer-dropdown"
            :options="skillOptions"
            :selected-values="selectedSkillPaths"
            placeholder="PLC Skills"
            search-placeholder="筛选内置 Skills"
            open-direction="up"
            :disabled="isInteractionDisabled"
            @toggle="onSkillToggle"
          />
          <ComposerAccessPicker :mode="accessMode" :plan="isPlanMode" :disabled="accessModeDisabled" @select="emit('update:access-mode', $event)" />
        </div>

        <div class="plc-composer-actions">
          <ComposerModelPicker
            :key="props.activeThreadId"
            :models="props.models"
            :selected-model="props.selectedModel"
            :selected-reasoning-effort="props.selectedReasoningEffort"
            :reasoning-efforts="props.reasoningEfforts"
            :disabled="isInteractionDisabled"
            @update:selected-model="emit('update:selected-model', $event)"
            @update:selected-reasoning-effort="emit('update:selected-reasoning-effort', $event)"
          />
          <span class="plc-context-indicator" :data-tone="contextView.tone" :title="contextTitle" :aria-label="contextTooltip" tabindex="0">
            <span class="plc-context-ring" :style="contextRingStyle"><span /></span>
            <span class="plc-context-tooltip" role="tooltip">{{ contextTooltip }}</span>
          </span>
          <button
            v-if="isTurnInProgress"
            type="button"
            class="plc-composer-queue"
            :disabled="!canSubmit"
            aria-label="排队发送任务"
            title="排队发送任务"
            @click="submitCurrent('queue')"
          >
            <IconTablerArrowUp aria-hidden="true" />
          </button>
          <button
            v-if="isTurnInProgress"
            type="button"
            class="plc-composer-stop"
            :disabled="!canSubmit"
            aria-label="立即调整方向"
            title="立即调整方向，当前操作完成后采用新指令"
            @click="submitCurrent('steer')"
          >
            <IconTablerBolt aria-hidden="true" />
          </button>
          <button
            v-if="isTurnInProgress"
            type="button"
            class="plc-composer-stop"
            aria-label="停止当前任务"
            title="停止当前任务"
            @click="emit('interrupt')"
          >
            <IconTablerPlayerStopFilled aria-hidden="true" />
          </button>
          <button
            v-else
            type="submit"
            class="plc-composer-submit"
            :disabled="!canSubmit"
            aria-label="发送任务"
            title="发送任务"
          >
            <IconTablerArrowUp aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
    <p v-if="isPlanMode" class="plc-plan-note">计划模式只读取和分析；退出计划模式后按所选权限执行。</p>
  </form>
</template>

<style scoped>
.plc-thread-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.plc-composer-shell {
  --composer-bg: #ffffff;
  --composer-border: #d4d4d4;
  --composer-text: #333333;
  --composer-muted: #737373;
  --composer-soft: rgba(0, 0, 0, 0.06);
  border: 1px solid var(--composer-border);
  border-radius: 8px;
  background: var(--composer-bg);
  color: var(--composer-text);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.plc-composer-shell:focus-within {
  border-color: #9b9b9b;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.05);
}

.plc-composer-shell.is-busy {
  border-color: #a3a3a3;
}

.plc-composer-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 12px 0;
}

.plc-composer-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 4px 7px;
  border-radius: 7px;
  background: var(--composer-soft);
  color: var(--composer-text);
  font-size: 11px;
  font-weight: 600;
}

.plc-composer-chip svg { width: 12px; height: 12px; flex: 0 0 auto; }
.plc-composer-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plc-composer-chip button { border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 15px; line-height: 1; padding: 0 1px; }

.plc-composer-editor { position: relative; padding: 12px 14px 8px; }

.plc-composer-context-row {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.plc-composer-context-row :deep(.composer-attachment-strip) {
  flex: 1 1 240px;
  margin: 0;
  padding: 0;
}

.plc-thread-composer.is-drag-active .plc-composer-shell { border-color: var(--plc-dark-accent, #007acc); box-shadow: 0 0 0 3px rgba(0, 122, 204, 0.14); }
.plc-composer-file-input { display: none; }
.plc-composer-attach { display: inline-flex; width: 27px; height: 27px; align-items: center; justify-content: center; border: 0; border-radius: 7px; background: transparent; color: var(--composer-muted); cursor: pointer; }
.plc-composer-attach:hover:not(:disabled) { background: var(--composer-soft); color: var(--composer-text); }
.plc-composer-attach:disabled { cursor: not-allowed; opacity: 0.42; }
.plc-composer-attach svg { width: 15px; height: 15px; }

.plc-composer-input {
  display: block;
  width: 100%;
  min-height: 72px;
  max-height: 220px;
  resize: vertical;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font: 14px/1.6 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.plc-composer-input::placeholder { color: var(--composer-muted); opacity: 0.78; }
.plc-composer-input:disabled { cursor: not-allowed; opacity: 0.58; }

.plc-composer-hint {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-top: 8px;
  color: var(--composer-muted);
  font-size: 10px;
  letter-spacing: 0.01em;
}

.plc-composer-hint code { color: #a86f22; font-size: 11px; }

.plc-composer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 6px 10px 8px 14px;
  border-top: 1px solid var(--composer-soft);
}

.plc-composer-options { display: flex; min-width: 0; align-items: center; flex-wrap: wrap; gap: 10px; }
.plc-composer-dropdown { min-width: 0; }
.plc-composer-options :deep(.composer-dropdown-trigger), .plc-composer-options :deep(.search-dropdown-trigger) { color: var(--composer-muted); font-size: 11px; }
.plc-composer-options :deep(.composer-dropdown-trigger:hover), .plc-composer-options :deep(.search-dropdown-trigger:hover) { color: var(--composer-text); }

.plc-composer-actions { display: flex; align-items: center; gap: 9px; flex: 0 0 auto; }

.plc-context-indicator { position: relative; display: inline-flex; width: 19px; height: 19px; align-items: center; justify-content: center; color: var(--composer-muted); outline: none; }
.plc-context-ring { display: inline-flex; width: 17px; height: 17px; align-items: center; justify-content: center; border-radius: 50%; background: conic-gradient(#007acc var(--context-percent), var(--composer-soft) 0); }
.plc-context-ring > span { width: 11px; height: 11px; border-radius: 50%; background: var(--composer-bg); }
.plc-context-indicator[data-tone="healthy"] .plc-context-ring { background: conic-gradient(#929292 var(--context-percent), var(--composer-soft) 0); }
.plc-context-indicator[data-tone="warning"] .plc-context-ring { background: conic-gradient(#b8832f var(--context-percent), var(--composer-soft) 0); }
.plc-context-indicator[data-tone="danger"] .plc-context-ring { background: conic-gradient(#b55248 var(--context-percent), var(--composer-soft) 0); }
.plc-context-tooltip { position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 20; display: none; width: max-content; max-width: 230px; border: 1px solid var(--composer-border); border-radius: 7px; background: var(--composer-bg); padding: 5px 7px; color: var(--composer-text); font-size: 10px; line-height: 1.4; white-space: nowrap; box-shadow: 0 9px 22px rgba(35, 29, 24, 0.16); pointer-events: none; }
.plc-context-indicator:hover .plc-context-tooltip,
.plc-context-indicator:focus-visible .plc-context-tooltip { display: block; }

.plc-composer-submit, .plc-composer-stop, .plc-composer-queue {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 9px;
  cursor: pointer;
  transition: transform 140ms ease, background 140ms ease, opacity 140ms ease;
}

.plc-composer-submit { background: #333; color: #fff; }
.plc-composer-submit:hover:not(:disabled), .plc-composer-stop:hover { transform: translateY(-1px); background: #525252; color: #fff; }
.plc-composer-submit:disabled { cursor: not-allowed; opacity: 0.35; }
.plc-composer-stop { background: #e5e5e5; color: #525252; }
.plc-composer-queue { width: 27px; height: 27px; border: 1px solid var(--composer-soft); border-radius: 50%; background: transparent; color: var(--composer-muted); }
.plc-composer-queue:hover:not(:disabled) { border-color: rgba(0, 122, 204, 0.55); background: rgba(0, 122, 204, 0.1); color: #007acc; transform: translateY(-1px); }
.plc-composer-queue:disabled { cursor: not-allowed; opacity: 0.35; }
.plc-composer-queue svg { width: 13px; height: 13px; }
.plc-composer-submit svg, .plc-composer-stop svg { width: 15px; height: 15px; }

.plc-plan-note { margin: 0 2px; color: #8a6a3c; font-size: 10px; }

@media (max-width: 720px) {
  .plc-composer-toolbar { align-items: flex-end; }
  .plc-composer-options { gap: 8px; }
  .plc-context-indicator { flex-shrink: 0; }
}

:global(:root.dark) .plc-composer-shell {
  --composer-bg: var(--plc-dark-input);
  --composer-border: var(--plc-dark-border);
  --composer-text: var(--plc-dark-text);
  --composer-muted: var(--plc-dark-muted);
  --composer-soft: var(--plc-dark-divider);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.22), 0 14px 34px rgba(0, 0, 0, 0.24);
}

:global(:root.dark) .plc-composer-chip { background: rgba(0, 122, 204, 0.18); color: #9cdcfe; }
:global(:root.dark) .plc-composer-submit { background: #0e639c; color: #ffffff; }
:global(:root.dark) .plc-composer-submit:hover:not(:disabled), :global(:root.dark) .plc-composer-stop:hover { background: var(--plc-dark-accent-hover); color: #ffffff; }
:global(:root.dark) .plc-composer-stop { background: var(--plc-dark-control); color: var(--plc-dark-text); }
:global(:root.dark) .plc-composer-queue { border-color: var(--plc-dark-border); color: var(--plc-dark-muted); }
:global(:root.dark) .plc-composer-queue:hover:not(:disabled) { border-color: rgba(0, 122, 204, 0.65); background: rgba(0, 122, 204, 0.18); color: #4fc1ff; }
:global(:root.dark) .plc-plan-note { color: var(--plc-dark-link); }
</style>
