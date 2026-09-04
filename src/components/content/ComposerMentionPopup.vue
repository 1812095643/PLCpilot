<script setup lang="ts">
import type { ComposerMentionSuggestion } from '../../api/plcBridge'
import IconTablerBolt from '../icons/IconTablerBolt.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerFolder from '../icons/IconTablerFolder.vue'

const props = withDefaults(defineProps<{
  suggestions: ComposerMentionSuggestion[]
  highlightedIndex: number
}>(), {
  suggestions: () => [],
  highlightedIndex: 0,
})

const emit = defineEmits<{
  select: [suggestion: ComposerMentionSuggestion]
  'update:highlighted-index': [index: number]
}>()

function kindLabel(kind: ComposerMentionSuggestion['kind']): string {
  if (kind === 'session') return '会话'
  if (kind === 'directory') return '文件夹'
  if (kind === 'active_file') return 'CODESYS'
  return '文件'
}

function kindTone(kind: ComposerMentionSuggestion['kind']): string {
  if (kind === 'session') return 'session'
  if (kind === 'directory') return 'directory'
  if (kind === 'active_file') return 'active'
  return 'file'
}

function suggestionId(suggestion: ComposerMentionSuggestion): string {
  return `plc-mention-${suggestion.id.replace(/[^a-zA-Z0-9_-]/gu, '-')}`
}

function directoryPrefix(suggestion: ComposerMentionSuggestion): string {
  if (suggestion.kind === 'session') return ''
  const normalizedPath = suggestion.path.replaceAll('\\', '/')
  const lastSlash = normalizedPath.lastIndexOf('/')
  if (lastSlash <= 0) return ''
  return `${normalizedPath.slice(0, lastSlash)}/`
}

function compactDescription(suggestion: ComposerMentionSuggestion): string {
  return (suggestion.description || '')
    .replace(/^(?:文件夹?|历史会话)\s*[·•]\s*/u, '')
    .replace(/\s*[·•]\s*(?:可读取|当前不可读取)\s*$/u, '')
    .trim()
}

function rowTitle(suggestion: ComposerMentionSuggestion): string {
  return `${suggestion.source} · ${suggestion.path} · ${suggestion.readable ? '可读取' : '不可读取'}`
}

function choose(suggestion: ComposerMentionSuggestion): void {
  emit('select', suggestion)
}
</script>

<template>
  <div id="plc-mention-popup" class="plc-mention-popup" role="listbox" aria-label="文件、文件夹和历史会话引用">
    <div v-if="suggestions.length > 0" class="plc-mention-list">
      <button
        v-for="(suggestion, index) in suggestions"
        :id="suggestionId(suggestion)"
        :key="suggestion.id"
        type="button"
        class="plc-mention-row"
        :class="{ 'is-highlighted': index === props.highlightedIndex }"
        role="option"
        :aria-selected="index === props.highlightedIndex"
        :aria-label="`${kindLabel(suggestion.kind)}：${suggestion.label}，${rowTitle(suggestion)}`"
        :title="rowTitle(suggestion)"
        @pointerenter="emit('update:highlighted-index', index)"
        @mousedown.prevent="choose(suggestion)"
      >
        <span class="plc-mention-icon" :data-tone="kindTone(suggestion.kind)" aria-hidden="true">
          <IconTablerFolder v-if="suggestion.kind === 'directory'" />
          <IconTablerBolt v-else-if="suggestion.kind === 'session'" />
          <IconTablerFilePencil v-else />
        </span>
        <span class="plc-mention-copy">
          <strong class="plc-mention-label">{{ suggestion.label }}</strong>
          <small class="plc-mention-kind" :data-tone="kindTone(suggestion.kind)">{{ kindLabel(suggestion.kind) }}</small>
          <span v-if="directoryPrefix(suggestion)" class="plc-mention-path">{{ directoryPrefix(suggestion) }}</span>
          <span v-if="compactDescription(suggestion)" class="plc-mention-meta">{{ compactDescription(suggestion) }}</span>
          <span class="plc-mention-source">{{ suggestion.source }}</span>
          <em class="plc-mention-readable" :data-readable="suggestion.readable">{{ suggestion.readable ? '可读取' : '不可读取' }}</em>
        </span>
      </button>
    </div>
    <p v-else class="plc-mention-empty">正在查找工程文件、文件夹和历史会话…</p>
  </div>
</template>

<style scoped>
.plc-mention-popup {
  position: absolute;
  right: 12px;
  bottom: calc(100% + 8px);
  left: 12px;
  z-index: 45;
  max-height: 310px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid rgba(72, 66, 58, 0.18);
  border-radius: 7px;
  background: #fffdf9;
  box-shadow: 0 0 0 1px rgba(35, 29, 24, 0.04), 0 14px 30px rgba(35, 29, 24, 0.18);
}

.plc-mention-list { display: grid; gap: 1px; }

.plc-mention-row {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 9px;
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #3a3530;
  cursor: pointer;
  text-align: left;
  transition: background-color 100ms ease;
}

.plc-mention-row:hover,
.plc-mention-row.is-highlighted { background: #e8f2fa; }

.plc-mention-row:focus-visible {
  outline: 1px solid #007acc;
  outline-offset: -1px;
}

.plc-mention-icon {
  display: inline-flex;
  width: 19px;
  height: 19px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
  color: #6e6760;
}

.plc-mention-icon[data-tone='directory'] { color: #d7a33d; }
.plc-mention-icon[data-tone='session'] { color: #4c9ac7; }
.plc-mention-icon[data-tone='active'] { color: #58a67c; }
.plc-mention-icon svg { width: 15px; height: 15px; }

.plc-mention-copy { display: flex; min-width: 0; flex: 1; align-items: center; gap: 7px; overflow: hidden; white-space: nowrap; }
.plc-mention-label { min-width: 0; overflow: hidden; color: #2f3a48; font: 12px/1.35 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-overflow: ellipsis; }
.plc-mention-kind { flex: 0 0 auto; color: #6e6760; font-size: 10px; }
.plc-mention-kind[data-tone='session'] { color: #2477a3; }
.plc-mention-kind[data-tone='active'] { color: #3b855e; }
.plc-mention-path { min-width: 0; max-width: 180px; overflow: hidden; color: #6e6760; font: 10px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace; text-overflow: ellipsis; }
.plc-mention-meta { min-width: 0; max-width: 240px; overflow: hidden; color: #8a837b; font-size: 10px; line-height: 1.35; text-overflow: ellipsis; }
.plc-mention-source { flex: 0 0 auto; color: #8a837b; font-size: 10px; }
.plc-mention-readable { flex: 0 0 auto; font-size: 10px; font-style: normal; color: #a35b52; }
.plc-mention-readable[data-readable='true'] { color: #4e9470; }
.plc-mention-empty { margin: 0; padding: 13px 10px; color: #8a837b; font-size: 12px; }

:global(:root.dark) .plc-mention-popup { border-color: var(--plc-dark-border); background: var(--plc-dark-surface); box-shadow: 0 18px 46px rgba(0, 0, 0, 0.46); }
:global(:root.dark) .plc-mention-row { color: var(--plc-dark-text); }
:global(:root.dark) .plc-mention-row:hover,
:global(:root.dark) .plc-mention-row.is-highlighted { background: var(--plc-dark-selection); }
:global(:root.dark) .plc-mention-label { color: #d4d4d4; }
:global(:root.dark) .plc-mention-kind,
:global(:root.dark) .plc-mention-path { color: var(--plc-dark-muted); }
:global(:root.dark) .plc-mention-meta,
:global(:root.dark) .plc-mention-source,
:global(:root.dark) .plc-mention-empty { color: #858585; }
:global(:root.dark) .plc-mention-readable[data-readable='true'] { color: #89d185; }
:global(:root.dark) .plc-mention-readable[data-readable='false'] { color: #f48771; }

@media (max-width: 640px) {
  .plc-mention-popup { right: 8px; left: 8px; }
}
</style>
