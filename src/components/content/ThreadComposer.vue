<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import type {
  CollaborationModeKind,
  CollaborationModeOption,
  ReasoningEffort,
  UiThreadTokenUsage,
} from '../../types/codex'
import { searchComposerFiles, type ComposerFileSuggestion } from '../../api/codexGateway'
import ComposerDropdown from './ComposerDropdown.vue'
import ComposerSearchDropdown from './ComposerSearchDropdown.vue'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
import IconTablerBolt from '../icons/IconTablerBolt.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
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
}

export type SubmitPayload = {
  text: string
  skills: Array<{ name: string; path: string }>
  mode: 'steer' | 'queue'
}

export type ThreadComposerExposed = {
  hydrateDraft: (payload: ComposerDraftPayload) => void
  appendTextToDraft: (text: string) => void
  hasUnsavedDraft: () => boolean
}

const props = withDefaults(defineProps<{
  activeThreadId: string
  cwd?: string
  collaborationModes?: CollaborationModeOption[]
  selectedCollaborationMode: CollaborationModeKind
  models: string[]
  selectedModel: string
  selectedReasoningEffort: ReasoningEffort | ''
  skills?: SkillItem[]
  threadTokenUsage?: UiThreadTokenUsage | null
  isTurnInProgress?: boolean
  disabled?: boolean
  sendWithEnter?: boolean
  inProgressSubmitMode?: 'steer' | 'queue'
}>(), {
  cwd: '',
  collaborationModes: () => [
    { value: 'default', label: '执行' },
    { value: 'plan', label: '计划' },
  ],
  skills: () => [],
  threadTokenUsage: null,
  isTurnInProgress: false,
  disabled: false,
  sendWithEnter: true,
  inProgressSubmitMode: 'steer',
})

const emit = defineEmits<{
  submit: [payload: SubmitPayload]
  interrupt: []
  'update:selected-collaboration-mode': [mode: CollaborationModeKind]
  'update:selected-model': [modelId: string]
  'update:selected-reasoning-effort': [effort: ReasoningEffort | '']
}>()

const DRAFT_STORAGE_PREFIX = 'plc-pilot.thread-draft.v2.'
const draft = shallowRef('')
const selectedSkills = shallowRef<SkillItem[]>([])
const activeInProgressMode = shallowRef<'steer' | 'queue'>(props.inProgressSubmitMode)
const isFileMentionOpen = shallowRef(false)
const mentionQuery = shallowRef('')
const mentionStartIndex = shallowRef<number | null>(null)
const mentionHighlightedIndex = shallowRef(0)
const fileMentionSuggestions = shallowRef<ComposerFileSuggestion[]>([])

let lastActiveThreadId = ''
let mentionSearchTimer: ReturnType<typeof setTimeout> | null = null
let mentionSearchToken = 0

const inputRef = shallowRef<HTMLTextAreaElement | null>(null)
const composerRootRef = shallowRef<HTMLElement | null>(null)

const modelOptions = computed(() => {
  const values = Array.from(new Set(props.models.map((item) => item.trim()).filter(Boolean)))
  if (props.selectedModel.trim() && !values.includes(props.selectedModel.trim())) {
    values.unshift(props.selectedModel.trim())
  }
  return values.map((value) => ({ value, label: value.replace(/^gpt/i, 'GPT') }))
})

const reasoningOptions: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'none', label: '不思考' },
  { value: 'minimal', label: '轻量' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '标准' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
]

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
const modeOptions = computed(() => props.collaborationModes.length > 0
  ? props.collaborationModes
  : [{ value: 'default' as const, label: '执行' }, { value: 'plan' as const, label: '计划' }])

const isInteractionDisabled = computed(() => props.disabled || !props.activeThreadId.trim())
const isPlanMode = computed(() => props.selectedCollaborationMode === 'plan')
const placeholder = computed(() => isInteractionDisabled.value
  ? '先选择一个本地 CODESYS 工程'
  : '描述要检查、修改或诊断的 PLC 任务…')
const hasUnsavedDraft = computed(() => draft.value.trim().length > 0 || selectedSkills.value.length > 0)
const canSubmit = computed(() => !isInteractionDisabled.value && draft.value.trim().length > 0)

const contextView = computed(() => {
  const usage = props.threadTokenUsage
  if (!usage) return { label: '上下文 —', tone: 'quiet' }
  let remaining = usage.remainingContextPercent
  if (remaining === null && usage.modelContextWindow && usage.modelContextWindow > 0) {
    remaining = Math.max(0, Math.round((1 - usage.currentContextTokens / usage.modelContextWindow) * 100))
  }
  if (remaining === null || !Number.isFinite(remaining)) return { label: '上下文 —', tone: 'quiet' }
  const tone = remaining <= 15 ? 'danger' : remaining <= 35 ? 'warning' : 'healthy'
  return { label: `上下文 ${Math.round(remaining)}%`, tone }
})

const contextTitle = computed(() => {
  const usage = props.threadTokenUsage
  if (!usage?.modelContextWindow) return '发送后会显示上下文占用'
  return `当前 ${usage.currentContextTokens.toLocaleString()} / ${usage.modelContextWindow.toLocaleString()} tokens`
})

const mentionVisible = computed(() => isFileMentionOpen.value && fileMentionSuggestions.value.length > 0)

function getDraftStorageKey(threadId: string): string {
  return `${DRAFT_STORAGE_PREFIX}${threadId.trim()}`
}

function emptyPayload(): ComposerDraftPayload {
  return { text: '', skills: [] }
}

function readDraft(threadId: string): ComposerDraftPayload | null {
  if (typeof window === 'undefined' || !threadId.trim()) return null
  try {
    const raw = window.localStorage.getItem(getDraftStorageKey(threadId))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<ComposerDraftPayload>
    return {
      text: typeof value.text === 'string' ? value.text : '',
      skills: Array.isArray(value.skills)
        ? value.skills.filter((skill): skill is { name: string; path: string } => Boolean(skill)
          && typeof skill.name === 'string' && typeof skill.path === 'string')
        : [],
    }
  } catch {
    return null
  }
}

function persistDraft(threadId: string): void {
  if (typeof window === 'undefined' || !threadId.trim()) return
  const payload: ComposerDraftPayload = {
    text: draft.value,
    skills: selectedSkills.value.map((skill) => ({ name: skill.name, path: skill.path })),
  }
  try {
    if (payload.text.trim() || payload.skills.length > 0) {
      window.localStorage.setItem(getDraftStorageKey(threadId), JSON.stringify(payload))
    } else {
      window.localStorage.removeItem(getDraftStorageKey(threadId))
    }
  } catch {
    // 本地存储不可用时不阻断任务发送，当前输入仍保留在窗口内。
  }
}

function replaceDraft(payload: ComposerDraftPayload): void {
  draft.value = payload.text
  selectedSkills.value = payload.skills.map((item) => props.skills.find((skill) => skill.path === item.path)
    ?? { name: item.name, path: item.path, description: '' })
  closeFileMention()
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
  void nextTick(() => inputRef.value?.focus())
}

function submitCurrent(mode: 'steer' | 'queue' = props.isTurnInProgress ? activeInProgressMode.value : 'steer'): void {
  if (!canSubmit.value) return
  emit('submit', {
    text: draft.value.trim(),
    skills: selectedSkills.value.map((skill) => ({ name: skill.name, path: skill.path })),
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
  if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
    && props.sendWithEnter !== false) {
    event.preventDefault()
    submitCurrent()
  }
}

function onInput(): void {
  updateFileMention()
}

function updateFileMention(): void {
  const input = inputRef.value
  const cwd = props.cwd?.trim() ?? ''
  if (!input || !cwd) {
    closeFileMention()
    return
  }
  const cursor = input.selectionStart ?? draft.value.length
  const beforeCursor = draft.value.slice(0, cursor)
  const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/u)
  if (!match) {
    closeFileMention()
    return
  }
  const token = match[0]
  mentionStartIndex.value = cursor - token.length + token.lastIndexOf('@')
  mentionQuery.value = match[2] ?? ''
  isFileMentionOpen.value = true
  mentionHighlightedIndex.value = 0
  scheduleMentionSearch(mentionQuery.value)
}

function scheduleMentionSearch(query: string): void {
  if (mentionSearchTimer) clearTimeout(mentionSearchTimer)
  const token = ++mentionSearchToken
  mentionSearchTimer = setTimeout(async () => {
    const rows = await searchComposerFiles(props.cwd?.trim() ?? '', query, 16)
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

function applyFileMention(item: ComposerFileSuggestion): void {
  const input = inputRef.value
  const start = mentionStartIndex.value
  if (!input || start === null) return
  const cursor = input.selectionStart ?? draft.value.length
  const replacement = `@${item.path} `
  draft.value = `${draft.value.slice(0, start)}${replacement}${draft.value.slice(cursor)}`
  closeFileMention()
  void nextTick(() => {
    const nextCursor = start + replacement.length
    inputRef.value?.focus()
    inputRef.value?.setSelectionRange(nextCursor, nextCursor)
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

function onDocumentPointerDown(event: PointerEvent): void {
  if (!isFileMentionOpen.value) return
  const root = composerRootRef.value
  const target = event.target
  if (!root || !(target instanceof Node) || root.contains(target)) return
  closeFileMention()
}

watch(() => props.inProgressSubmitMode, (value) => {
  activeInProgressMode.value = value
})

watch(() => props.activeThreadId, (threadId) => {
  if (lastActiveThreadId) persistDraft(lastActiveThreadId)
  const restored = readDraft(threadId)
  replaceDraft(restored ?? emptyPayload())
  lastActiveThreadId = threadId.trim()
}, { immediate: true })

watch([draft, selectedSkillPaths], () => {
  if (lastActiveThreadId) persistDraft(lastActiveThreadId)
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  if (mentionSearchTimer) clearTimeout(mentionSearchTimer)
})

defineExpose<ThreadComposerExposed>({
  hydrateDraft,
  appendTextToDraft,
  hasUnsavedDraft: () => hasUnsavedDraft.value,
})
</script>

<template>
  <form ref="composerRootRef" class="plc-thread-composer" @submit.prevent="submitCurrent()">
    <div class="plc-composer-shell" :class="{ 'is-busy': isTurnInProgress }">
      <div v-if="selectedSkills.length > 0" class="plc-composer-chips" aria-label="已启用 Skills">
        <span v-for="skill in selectedSkills" :key="skill.path" class="plc-composer-chip">
          <IconTablerBolt aria-hidden="true" />
          <span>{{ skill.displayName || skill.name }}</span>
          <button type="button" aria-label="移除 Skill" @click="removeSkill(skill.path)">×</button>
        </span>
      </div>

      <div class="plc-composer-editor">
        <div v-if="isFileMentionOpen" class="plc-file-mention-menu" role="listbox" aria-label="工程文件引用">
          <button
            v-for="(item, index) in fileMentionSuggestions"
            :key="item.path"
            type="button"
            class="plc-file-mention-row"
            :class="{ 'is-highlighted': index === mentionHighlightedIndex }"
            @mousedown.prevent="applyFileMention(item)"
          >
            <IconTablerFilePencil aria-hidden="true" />
            <span>{{ item.path }}</span>
          </button>
          <p v-if="fileMentionSuggestions.length === 0" class="plc-file-mention-empty">正在查找工程文件…</p>
        </div>

        <textarea
          ref="inputRef"
          v-model="draft"
          class="plc-composer-input"
          :placeholder="placeholder"
          :disabled="isInteractionDisabled"
          rows="3"
          @input="onInput"
          @keydown="onKeydown"
        />
        <div class="plc-composer-hint">
          <span>Enter 发送 · Shift+Enter 换行</span>
          <span><code>@</code> 引用工程文件</span>
        </div>
      </div>

      <div class="plc-composer-toolbar">
        <div class="plc-composer-options">
          <ComposerDropdown
            class="plc-composer-dropdown"
            :model-value="selectedModel"
            :options="modelOptions"
            placeholder="模型"
            open-direction="up"
            :disabled="isInteractionDisabled || modelOptions.length === 0"
            enable-search
            search-placeholder="搜索模型"
            @update:model-value="emit('update:selected-model', $event)"
          />
          <ComposerDropdown
            class="plc-composer-dropdown"
            :model-value="selectedCollaborationMode"
            :options="modeOptions"
            placeholder="模式"
            open-direction="up"
            :disabled="isInteractionDisabled"
            @update:model-value="emit('update:selected-collaboration-mode', $event as CollaborationModeKind)"
          />
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
          <ComposerDropdown
            class="plc-composer-dropdown"
            :model-value="selectedReasoningEffort || 'medium'"
            :options="reasoningOptions"
            placeholder="思考"
            open-direction="up"
            :disabled="isInteractionDisabled"
            @update:model-value="emit('update:selected-reasoning-effort', $event as ReasoningEffort)"
          />
        </div>

        <div class="plc-composer-actions">
          <span class="plc-context-indicator" :data-tone="contextView.tone" :title="contextTitle">
            <span class="plc-context-dot" />
            {{ contextView.label }}
          </span>
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
    <p v-if="isPlanMode" class="plc-plan-note">计划模式会先整理执行步骤，工程写入仍需逐项审批。</p>
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
  --composer-bg: #fbfaf7;
  --composer-border: rgba(72, 66, 58, 0.18);
  --composer-text: #24211e;
  --composer-muted: #77716a;
  --composer-soft: rgba(72, 66, 58, 0.07);
  border: 1px solid var(--composer-border);
  border-radius: 16px;
  background: var(--composer-bg);
  color: var(--composer-text);
  box-shadow: 0 0 0 1px rgba(20, 17, 14, 0.02), 0 10px 28px rgba(35, 29, 24, 0.08);
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.plc-composer-shell:focus-within {
  border-color: rgba(168, 111, 34, 0.5);
  box-shadow: 0 0 0 3px rgba(168, 111, 34, 0.1), 0 12px 30px rgba(35, 29, 24, 0.1);
}

.plc-composer-shell.is-busy {
  border-color: rgba(168, 111, 34, 0.36);
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
  background: rgba(168, 111, 34, 0.11);
  color: #85551c;
  font-size: 11px;
  font-weight: 600;
}

.plc-composer-chip svg { width: 12px; height: 12px; flex: 0 0 auto; }
.plc-composer-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plc-composer-chip button { border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 15px; line-height: 1; padding: 0 1px; }

.plc-composer-editor { position: relative; padding: 12px 14px 8px; }

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

.plc-composer-options { display: flex; min-width: 0; align-items: center; flex-wrap: wrap; gap: 12px; }
.plc-composer-dropdown { min-width: 0; }
.plc-composer-options :deep(.composer-dropdown-trigger), .plc-composer-options :deep(.search-dropdown-trigger) { color: var(--composer-muted); font-size: 11px; }
.plc-composer-options :deep(.composer-dropdown-trigger:hover), .plc-composer-options :deep(.search-dropdown-trigger:hover) { color: var(--composer-text); }

.plc-composer-actions { display: flex; align-items: center; gap: 9px; flex: 0 0 auto; }

.plc-context-indicator { display: inline-flex; align-items: center; gap: 5px; color: var(--composer-muted); font-size: 10px; white-space: nowrap; }
.plc-context-dot { width: 6px; height: 6px; border-radius: 50%; background: #9b958e; }
.plc-context-indicator[data-tone="healthy"] .plc-context-dot { background: #4e9470; }
.plc-context-indicator[data-tone="warning"] .plc-context-dot { background: #b8832f; }
.plc-context-indicator[data-tone="danger"] .plc-context-dot { background: #b55248; }

.plc-composer-submit, .plc-composer-stop {
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

.plc-composer-submit { background: #2b2926; color: #fffaf1; }
.plc-composer-submit:hover:not(:disabled), .plc-composer-stop:hover { transform: translateY(-1px); background: #a86f22; }
.plc-composer-submit:disabled { cursor: not-allowed; opacity: 0.35; }
.plc-composer-stop { background: #ebe5dc; color: #655e56; }
.plc-composer-submit svg, .plc-composer-stop svg { width: 15px; height: 15px; }

.plc-plan-note { margin: 0 2px; color: #8a6a3c; font-size: 10px; }

.plc-file-mention-menu {
  position: absolute;
  right: 12px;
  bottom: calc(100% - 2px);
  z-index: 30;
  width: min(460px, calc(100% - 24px));
  max-height: 250px;
  overflow: auto;
  padding: 5px;
  border: 1px solid rgba(72, 66, 58, 0.16);
  border-radius: 12px;
  background: #fffdf9;
  box-shadow: 0 16px 40px rgba(35, 29, 24, 0.18);
}

.plc-file-mention-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 9px; border: 0; border-radius: 8px; background: transparent; color: #3a3530; cursor: pointer; text-align: left; font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; }
.plc-file-mention-row:hover, .plc-file-mention-row.is-highlighted { background: #f3ede4; }
.plc-file-mention-row svg { width: 14px; height: 14px; flex: 0 0 auto; color: #a86f22; }
.plc-file-mention-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plc-file-mention-empty { margin: 0; padding: 12px; color: #8a837b; font-size: 12px; }

@media (max-width: 720px) {
  .plc-composer-toolbar { align-items: flex-end; }
  .plc-composer-options { gap: 8px; }
  .plc-context-indicator { display: none; }
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
:global(:root.dark) .plc-file-mention-menu { border-color: var(--plc-dark-border); background: var(--plc-dark-surface); box-shadow: 0 18px 46px rgba(0, 0, 0, 0.42); }
:global(:root.dark) .plc-file-mention-row { color: var(--plc-dark-text); }
:global(:root.dark) .plc-file-mention-row:hover, :global(:root.dark) .plc-file-mention-row.is-highlighted { background: #2a2d2e; }
:global(:root.dark) .plc-file-mention-empty { color: var(--plc-dark-muted); }
:global(:root.dark) .plc-plan-note { color: var(--plc-dark-link); }
</style>
