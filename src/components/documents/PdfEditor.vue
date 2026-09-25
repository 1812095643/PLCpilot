<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { renderDocumentPage, pickDocument, type DocumentSnapshot, type DocumentNode, type DocumentOperation, type DocumentSelection } from '../../api/documents'
const props = defineProps<{ document: DocumentSnapshot; busy: boolean }>()
const emit = defineEmits<{ apply: [operations: DocumentOperation[]]; quote: [selection: DocumentSelection]; notice: [message: string] }>()
const pageIndex = shallowRef(0), preview = shallowRef(''), loading = shallowRef(false), error = shallowRef(''), selectedId = shallowRef(''), draft = shallowRef(''), query = shallowRef('')
const page = computed(() => props.document.nodes[pageIndex.value])
const selected = computed(() => page.value?.children.find(node => node.id === selectedId.value))
const results = computed(() => query.value.trim() ? props.document.nodes.filter(node => node.text.toLowerCase().includes(query.value.toLowerCase())) : [])
watch([() => props.document.id, () => props.document.version, pageIndex], async (_, __, cleanup) => {
  let stale = false; cleanup(() => { stale = true }); loading.value = true; error.value = ''
  try { const image = await renderDocumentPage(props.document, pageIndex.value); if (!stale) preview.value = image }
  catch (cause) { if (!stale) error.value = String(cause) }
  finally { if (!stale) { loading.value = false; if (selected.value) draft.value = selected.value.text } }
}, { immediate: true })
function box(node: DocumentNode) {
  const bounds = node.properties.bounds as { x: number; y: number; width: number; height: number }
  const width = Number(page.value?.properties.width), height = Number(page.value?.properties.height)
  return { left: `${bounds.x / width * 100}%`, top: `${bounds.y / height * 100}%`, width: `${bounds.width / width * 100}%`, height: `${bounds.height / height * 100}%` }
}
function select(node: DocumentNode) { selectedId.value = node.id; draft.value = node.text }
function quote() { if (!page.value) return; const node = selected.value ?? page.value; emit('quote', { documentId: props.document.id, version: props.document.version, path: props.document.path, nodeId: node.id, text: node.text }) }
function apply() { if (selected.value?.text) emit('apply', [{ op: 'replace_text', target: selected.value.id, before: selected.value.text, after: draft.value }]) }
async function replaceImage() { if (!selected.value) return; try { const path = await pickDocument(); if (path) emit('apply', [{ op: 'replace_image', target: selected.value.id, path }]) } catch (cause) { emit('notice', String(cause)) } }
</script>
<template>
  <div class="pdf-editor">
    <div class="pdf-tools"><button :disabled="pageIndex <= 0" @click="pageIndex--">‹</button><select v-model="pageIndex" aria-label="PDF 页码"><option v-for="(_, index) in document.nodes" :key="index" :value="index">{{ index + 1 }} / {{ document.nodes.length }}</option></select><button :disabled="pageIndex >= document.nodes.length - 1" @click="pageIndex++">›</button><input v-model="query" placeholder="搜索 PDF" aria-label="搜索 PDF" /><button @click="quote">引用</button></div>
    <div v-if="query" class="pdf-results"><button v-for="result in results" :key="result.id" @click="pageIndex = Number(result.properties.page)">第 {{ Number(result.properties.page) + 1 }} 页</button><span v-if="!results.length">没有匹配文字；扫描件需要先识别。</span></div>
    <div class="pdf-scroll"><p v-if="error" class="pdf-error">{{ error }}</p><p v-if="loading" class="pdf-status" role="status">正在渲染第 {{ pageIndex + 1 }} 页…</p><div v-if="page && preview && !loading" class="pdf-page"><img :src="preview" class="pdf-page-image" :alt="`第 ${pageIndex + 1} 页`" /><button v-for="node in page.children" :key="node.id" class="pdf-object" :class="{ selected: selectedId === node.id }" :style="box(node)" :title="node.kind === 'pdf_image' ? '编辑图片' : node.text" :aria-label="node.kind === 'pdf_image' ? '选择 PDF 图片' : `选择文字：${node.text}`" @click="select(node)" /></div></div>
    <section v-if="selected" class="pdf-edit"><span>{{ selected.kind === 'pdf_image' ? '已选择图片' : '修改 PDF 文字对象' }}</span><template v-if="selected.kind === 'pdf_text'"><textarea v-model="draft" rows="2" :disabled="busy" aria-label="PDF 文字" /><button :disabled="busy || draft === selected.text" @click="apply">应用修改</button></template><button v-else :disabled="busy" @click="replaceImage">替换图片</button><small>文字使用原字体；复杂布局请保存后核对。</small></section>
    <p v-else class="pdf-hint">点击页面内文字或图片即可局部编辑。</p>
  </div>
</template>
<style scoped>
.pdf-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; }.pdf-tools { display: flex; align-items: center; gap: 5px; padding: 8px; }.pdf-tools button,.pdf-tools select,.pdf-results button { border: 0; background: var(--document-field); color: var(--document-text); border-radius: 4px; padding: 5px 8px; font-size: 11px; cursor: pointer; }.pdf-tools input { min-width: 50px; flex: 1; border: 0; padding: 6px 9px; background: var(--document-field); color: var(--document-text); border-radius: 4px; font-size: 11px; }.pdf-results { display: flex; gap: 4px; flex-wrap: wrap; padding: 0 8px 8px; font-size: 11px; color: var(--document-muted); }.pdf-scroll { flex: 1; min-height: 0; overflow: auto; background: var(--document-field); padding: 20px; }.pdf-page { position: relative; margin: auto; max-width: 1000px; box-shadow: 0 2px 15px #00000010; }.pdf-page-image { width: 100%; display: block; }.pdf-object { position: absolute; border: 0; padding: 0; background: transparent; cursor: text; }.pdf-object:hover { background: #e7b56822; outline: 1px solid #c39663; }.pdf-object.selected { background: #e7b56833; outline: 1.5px solid #d49b50; }.pdf-edit { padding: 12px; border-top: 1px solid var(--document-line); display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 11px; }.pdf-edit textarea { width: 100%; background: var(--document-field); color: var(--document-text); border: 0; padding: 8px; border-radius: 4px; }.pdf-edit button { border: 0; background: var(--document-text); color: var(--document-bg); padding: 6px 11px; border-radius: 5px; cursor: pointer; }.pdf-edit button:disabled { opacity: .4; }.pdf-edit small,.pdf-hint,.pdf-status { color: var(--document-muted); font-size: 11px; }.pdf-hint { text-align: center; padding: 10px; margin: 0; }.pdf-error { color: #c06455; font-size: 12px; }
</style>
