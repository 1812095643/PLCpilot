<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { IconX, IconFile, IconFolderOpen, IconExternalLink, IconLayoutSidebarRightCollapse, IconRefresh, IconDeviceFloppy, IconArrowBackUp, IconArrowForwardUp } from '@tabler/icons-vue'
import { openLocalPath } from '../../api/plcBridge'
import type { DocumentSnapshot, DocumentSelection, DocumentOperation } from '../../api/documents'
const props = defineProps<{ tabs: DocumentSnapshot[]; active: DocumentSnapshot | null; loading: boolean; busy: boolean }>()
const emit = defineEmits<{ select: [id: string]; close: [id: string]; hide: []; refresh: [path: string]; quote: [selection: DocumentSelection]; notice: [message: string]; apply: [operations: DocumentOperation[]]; save: []; history: [redo: boolean] }>()
const ImagePreview = defineAsyncComponent(() => import('./ImagePreview.vue'))
const HtmlPreview = defineAsyncComponent(() => import('./HtmlPreview.vue'))
const TextPreview = defineAsyncComponent(() => import('./TextPreview.vue'))
const OfficeEditor = defineAsyncComponent(() => import('./OfficeEditor.vue'))
const SpreadsheetEditor = defineAsyncComponent(() => import('./SpreadsheetEditor.vue'))
const PdfEditor = defineAsyncComponent(() => import('./PdfEditor.vue'))
async function external(mode: 'reveal' | 'default') { if (!props.active) return; try { await openLocalPath(props.active.path, mode) } catch (error) { emit('notice', String(error)) } }
</script>

<template>
  <section class="document-workspace" aria-label="文件工作区">
    <header class="document-heading"><span>文件工作区</span><div class="document-actions"><button title="收起文件工作区" aria-label="收起文件工作区" @click="emit('hide')"><IconLayoutSidebarRightCollapse /></button></div></header>
    <nav v-if="tabs.length" class="document-tabs" aria-label="已打开的文件">
      <div v-for="tab in tabs" :key="tab.id" class="document-tab" :class="{ active: tab.id === active?.id }"><button class="document-tab-name" :title="tab.path" :aria-current="tab.id === active?.id ? 'page' : undefined" @click="emit('select', tab.id)"><IconFile /><span>{{ tab.name }}</span></button><button class="document-tab-close" :aria-label="`关闭 ${tab.name}`" @click="emit('close', tab.id)"><IconX /></button></div>
    </nav>
    <div v-if="active" class="document-toolbar"><span class="document-format">{{ active.kind.toUpperCase() }}</span><span class="document-size">{{ active.dirty ? '未保存' : `${(active.size / 1024).toFixed(1)} KB` }}</span><span class="toolbar-spacer" /><template v-if="active.can_edit"><button :disabled="busy || !active.can_undo" title="撤销" aria-label="撤销" @click="emit('history', false)"><IconArrowBackUp /></button><button :disabled="busy || !active.can_redo" title="重做" aria-label="重做" @click="emit('history', true)"><IconArrowForwardUp /></button><button :disabled="busy || !active.dirty" title="保存文件" aria-label="保存文件" @click="emit('save')"><IconDeviceFloppy /></button></template><button title="在文件管理器中显示" aria-label="在文件管理器中显示" @click="external('reveal')"><IconFolderOpen /></button><button title="使用默认应用打开" aria-label="使用默认应用打开" @click="external('default')"><IconExternalLink /></button></div>
    <div v-if="loading" class="document-loading" role="status"><IconRefresh class="loading-spin" />正在读取文件…</div>
    <div v-else-if="active" class="document-body">
      <p v-for="warning in active.warnings" :key="warning" class="document-warning">{{ warning }}</p>
      <ImagePreview v-if="active.kind === 'image'" :key="active.id" :document="active" />
      <HtmlPreview v-else-if="active.kind === 'html'" :key="active.id" :document="active" @select="emit('quote', $event)" />
      <OfficeEditor v-else-if="active.kind === 'docx' || active.kind === 'pptx'" :key="active.id" :document="active" :busy="busy" @apply="emit('apply', $event)" @quote="emit('quote', $event)" @notice="emit('notice', $event)" />
      <SpreadsheetEditor v-else-if="active.kind === 'xlsx'" :key="active.id" :document="active" :busy="busy" @apply="emit('apply', $event)" @quote="emit('quote', $event)" />
      <PdfEditor v-else-if="active.kind === 'pdf'" :key="active.id" :document="active" :busy="busy" @apply="emit('apply', $event)" @quote="emit('quote', $event)" @notice="emit('notice', $event)" />
      <TextPreview v-else :key="active.id" :document="active" @select="emit('quote', $event)" />
    </div>
    <div v-else class="document-empty"><IconFile /><h3>文件就在对话旁</h3><p>点击对话中的文件链接或附件，文件会自动在这里展开。</p></div>
  </section>
</template>

<style scoped>
.document-workspace { --document-bg: #fafafa; --document-text: #292929; --document-muted: #858585; --document-line: #e5e5e5; --document-field: #eeeeee; background: var(--document-bg); color: var(--document-text); height: 100%; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
:global(.dark .document-workspace) { --document-bg: #1e1e1e; --document-text: #dedede; --document-muted: #929292; --document-line: #353535; --document-field: #292929; }
.document-heading { display: flex; justify-content: space-between; align-items: center; height: 46px; padding: 0 16px; border-bottom: 1px solid var(--document-line); font-size: 12px; font-weight: 500; flex-shrink: 0; }
.document-actions,.document-toolbar { display: flex; align-items: center; gap: 5px; }.document-actions button,.document-toolbar button,.document-tab-close { background: transparent; border: 0; padding: 5px; color: var(--document-muted); cursor: pointer; border-radius: 5px; }.document-actions svg,.document-toolbar svg { width: 17px; height: 17px; }.document-actions button:hover,.document-toolbar button:hover,.document-tab-close:hover { color: var(--document-text); background: var(--document-field); }
.document-tabs { display: flex; overflow: auto; flex-shrink: 0; border-bottom: 1px solid var(--document-line); padding: 6px 8px 0; gap: 3px; }.document-tab { display: flex; align-items: center; max-width: 240px; flex-shrink: 0; border-bottom: 2px solid transparent; }.document-tab.active { border-bottom-color: #e59b43; background: var(--document-field); border-radius: 5px 5px 0 0; }.document-tab-name { display: flex; align-items: center; gap: 6px; color: var(--document-muted); background: none; border: 0; padding: 8px; min-width: 0; cursor: pointer; font-size: 11px; }.document-tab.active .document-tab-name { color: var(--document-text); }.document-tab-name span { text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }.document-tab-name svg { width: 14px; height: 14px; flex-shrink: 0; }.document-tab-close { margin-right: 3px; }.document-tab-close svg { width: 12px; height: 12px; }
.document-toolbar { padding: 5px 12px; border-bottom: 1px solid var(--document-line); flex-shrink: 0; }.document-format { font-size: 10px; letter-spacing: .05em; }.document-size { font-size: 10px; color: var(--document-muted); margin-left: 5px; }.toolbar-spacer { flex: 1; }
.document-body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }.document-body> :not(.document-warning) { flex: 1; min-height: 0; }.document-warning { color: #bd8333; font-size: 11px; margin: 6px 12px; flex-shrink: 0; }.document-toolbar button:disabled { opacity: .3; cursor: default; }
.document-empty,.document-loading { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--document-muted); gap: 12px; padding: 35px; text-align: center; }.document-empty>svg { width: 32px; height: 32px; opacity: .5; }.document-empty h3 { font-size: 15px; color: var(--document-text); font-weight: 500; margin: 0; }.document-empty p { font-size: 12px; margin: 0; line-height: 1.8; }.document-empty button { margin-top: 5px; border: 0; border-radius: 6px; background: var(--document-field); color: var(--document-text); padding: 8px 16px; font-size: 12px; cursor: pointer; }.document-loading { font-size: 12px; }.loading-spin { width: 20px; height: 20px; animation: document-spin 1.8s linear infinite; }
@keyframes document-spin { to { transform: rotate(360deg); } }@media(prefers-reduced-motion:reduce) { .loading-spin { animation: none; } }
</style>
