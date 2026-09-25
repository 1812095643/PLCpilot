<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import hljs from 'highlight.js/lib/common'
import type { DocumentSnapshot, DocumentSelection } from '../../api/documents'

const props = defineProps<{ document: DocumentSnapshot }>()
const emit = defineEmits<{ select: [selection: DocumentSelection] }>()
const query = shallowRef('')
const wrap = shallowRef(false)
const extension = computed(() => props.document.name.split('.').pop()?.toLowerCase() ?? '')
const language = computed(() => ({ vue: 'xml', st: 'iecst', iecst: 'iecst', rs: 'rust', py: 'python', md: 'markdown', ts: 'typescript', js: 'javascript' }[extension.value] ?? extension.value))
const lines = computed(() => {
  const text = props.document.text ?? ''
  // 高亮库会转义文件正文；不直接插入文件提供的 HTML。
  const value = hljs.getLanguage(language.value) ? hljs.highlight(text, { language: language.value }).value : hljs.highlight(text, { language: 'plaintext' }).value
  return value.split('\n')
})
const matches = computed(() => {
  const term = query.value.toLocaleLowerCase()
  return new Set(term ? (props.document.text ?? '').split('\n').flatMap((line, index) => line.toLocaleLowerCase().includes(term) ? [index] : []) : [])
})
function quote() {
  const text = window.getSelection()?.toString().trim()
  if (text) emit('select', { documentId: props.document.id, version: props.document.version, path: props.document.path, text })
}
</script>

<template>
  <div class="text-preview">
    <div class="text-preview-tools">
      <input v-model="query" class="preview-search" placeholder="搜索文件内容" aria-label="搜索文件内容" />
      <span v-if="query">{{ matches.size }} 行匹配</span>
      <button class="preview-text-button" :aria-pressed="wrap" @click="wrap = !wrap">自动换行</button>
      <button class="preview-text-button" @mousedown.prevent @click="quote">引用选中内容</button>
    </div>
    <div class="text-lines" :class="{ wrap }" tabindex="0">
      <div v-for="(line, index) in lines" :key="index" class="text-line" :class="{ match: matches.has(index) }">
        <span class="line-number" aria-hidden="true">{{ index + 1 }}</span><code class="line-code" v-html="line || ' '" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.text-preview { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.text-preview-tools { display: flex; gap: 8px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--document-line); color: var(--document-muted); font-size: 11px; flex-wrap: wrap; }
.preview-search { flex: 1; min-width: 100px; background: var(--document-field); color: var(--document-text); border: 0; border-radius: 5px; padding: 6px 9px; outline-offset: 2px; }
.preview-text-button { border: 0; background: transparent; color: inherit; cursor: pointer; padding: 5px; border-radius: 4px; white-space: nowrap; }
.preview-text-button:hover,.preview-text-button[aria-pressed=true] { background: var(--document-field); color: var(--document-text); }
.text-lines { overflow: auto; padding: 16px 0 32px; flex: 1; min-height: 0; font: 12px/1.85 'Cascadia Code', Consolas, monospace; tab-size: 4; }
.text-line { display: flex; min-width: max-content; padding-right: 20px; }
.text-line.match { background: #f5a62325; }
.line-number { width: 48px; padding-right: 13px; color: var(--document-muted); opacity: .65; text-align: right; user-select: none; flex-shrink: 0; }
.line-code { white-space: pre; color: var(--document-text); }
.wrap .text-line { min-width: 0; }.wrap .line-code { white-space: pre-wrap; overflow-wrap: anywhere; }
.line-code :deep(.hljs-keyword),.line-code :deep(.hljs-selector-tag) { color: #b77ddb; }
.line-code :deep(.hljs-string),.line-code :deep(.hljs-attr) { color: #b48055; }
.line-code :deep(.hljs-number),.line-code :deep(.hljs-literal) { color: #6c9b7e; }
.line-code :deep(.hljs-comment) { color: #808080; }
</style>
