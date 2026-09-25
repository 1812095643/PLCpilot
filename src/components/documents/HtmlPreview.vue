<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import TextPreview from './TextPreview.vue'
import type { DocumentSelection, DocumentSnapshot } from '../../api/documents'

const props = defineProps<{ document: DocumentSnapshot }>()
const emit = defineEmits<{ select: [selection: DocumentSelection] }>()
const view = shallowRef<'render' | 'source'>('render')

const sourceDocument = computed(() => ({ ...props.document, kind: 'text' as const }))
const previewHtml = computed(() => createPreviewDocument(props.document.text ?? ''))

function createPreviewDocument(source: string): string {
  const safeSource = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '')
    .replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, '')
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; font-src data:; media-src data: blob:;">'
  const previewStyle = '<style>html,body{margin:0;padding:0;background:#fff;color:#222;font:14px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif}body{padding:28px;box-sizing:border-box}a,button,input,textarea,select,form{pointer-events:none}img{max-width:100%;height:auto}pre{overflow:auto;white-space:pre-wrap}table{max-width:100%;border-collapse:collapse}th,td{border:1px solid #d8d8d8;padding:6px 9px;text-align:left}</style>'
  if (/<head\b[^>]*>/i.test(safeSource)) return safeSource.replace(/<head\b[^>]*>/i, (tag) => `${tag}${policy}${previewStyle}`)
  return `<!doctype html><html><head>${policy}${previewStyle}</head><body>${safeSource}</body></html>`
}
</script>

<template>
  <div class="html-preview">
    <div class="html-preview-tools">
      <button class="html-view-button" :class="{ active: view === 'render' }" type="button" @click="view = 'render'">预览</button>
      <button class="html-view-button" :class="{ active: view === 'source' }" type="button" @click="view = 'source'">源码</button>
      <span class="html-preview-note">脚本、表单和页面跳转已禁用</span>
    </div>
    <div v-if="view === 'render'" class="html-frame-wrap">
      <iframe class="html-frame" :srcdoc="previewHtml" :title="`${document.name} HTML 预览`" sandbox="" referrerpolicy="no-referrer" />
    </div>
    <TextPreview v-else :document="sourceDocument" @select="emit('select', $event)" />
  </div>
</template>

<style scoped>
.html-preview { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.html-preview-tools { display: flex; align-items: center; gap: 5px; padding: 8px 12px; border-bottom: 1px solid var(--document-line); color: var(--document-muted); font-size: 11px; flex-shrink: 0; }
.html-view-button { border: 0; border-radius: 5px; background: transparent; color: inherit; cursor: pointer; padding: 6px 11px; }
.html-view-button:hover, .html-view-button.active { background: var(--document-field); color: var(--document-text); }
.html-preview-note { margin-left: auto; color: var(--document-muted); font-size: 10px; }
.html-frame-wrap { flex: 1; min-height: 0; background: #f0f0f0; padding: 12px; }
.html-frame { display: block; width: 100%; height: 100%; border: 0; border-radius: 5px; background: #fff; box-shadow: 0 1px 4px #00000012; }
@media (max-width: 640px) { .html-preview-note { display: none; } }
</style>
