<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { pickDocument, type DocumentSnapshot, type DocumentNode, type DocumentOperation, type DocumentSelection } from '../../api/documents'
import WordBlock from './WordBlock.vue'
const props = defineProps<{ document: DocumentSnapshot; busy: boolean }>()
const emit = defineEmits<{ apply: [operations: DocumentOperation[]]; quote: [selection: DocumentSelection]; notice: [message: string] }>()
const selectedId = shallowRef('')
const draft = shallowRef('')
const pageIndex = shallowRef(0)
const page = computed(() => props.document.nodes[pageIndex.value])
function find(nodes: DocumentNode[], id: string): DocumentNode | undefined { for (const node of nodes) { if (node.id === id) return node; const found = find(node.children, id); if (found) return found } }
const selected = computed(() => find(props.document.nodes, selectedId.value))
function select(node: DocumentNode) { selectedId.value = node.id; draft.value = node.text }
watch(() => props.document.version, () => { if (selected.value) draft.value = selected.value.text })
const pageStyle = computed(() => ({ aspectRatio: `${page.value?.properties.width ?? 960} / ${page.value?.properties.height ?? 540}`, background: String(page.value?.properties.background ?? '#fff') }))
function bounds(node: DocumentNode) { return node.properties.bounds as { x: number; y: number; width: number; height: number } }
function shapeStyle(node: DocumentNode) {
  const box = bounds(node); const w = Number(page.value?.properties.width ?? 960); const h = Number(page.value?.properties.height ?? 540)
  return { left: `${box.x / w * 100}%`, top: `${box.y / h * 100}%`, width: `${box.width / w * 100}%`, height: `${box.height / h * 100}%`, transform: `rotate(${Number(node.properties.rotation ?? 0)}deg)`, fontSize: `${Number(node.properties.font_size ?? 18) / w * 100}cqw` }
}
function apply() { if (selected.value?.text && draft.value !== selected.value.text) emit('apply', [{ op: 'replace_text', target: selected.value.id, before: selected.value.text, after: draft.value }]) }
function quote() { if (!selected.value) return; const text = window.getSelection()?.toString().trim() || selected.value.text; emit('quote', { documentId: props.document.id, version: props.document.version, path: props.document.path, nodeId: selected.value.id, text }) }
async function replaceImage() { if (!selected.value) return; try { const path = await pickDocument(); if (path) emit('apply', [{ op: 'replace_image', target: selected.value.id, path }]) } catch (error) { emit('notice', String(error)) } }
</script>
<template>
  <div class="office-editor">
    <div v-if="document.kind === 'pptx'" class="slide-navigation"><button :disabled="pageIndex === 0" @click="pageIndex--">‹</button><select v-model="pageIndex" aria-label="选择幻灯片"><option v-for="(slide, index) in document.nodes" :key="slide.id" :value="index">{{ slide.text }}</option></select><button :disabled="pageIndex >= document.nodes.length - 1" @click="pageIndex++">›</button><span>{{ document.nodes.length }} 页</span></div>
    <div class="office-scroll">
      <article v-if="document.kind === 'docx'" class="word-paper"><WordBlock v-for="node in document.nodes" :key="node.id" :node="node" :selected="selectedId" @select="select" /></article>
      <div v-else-if="page" class="slide-paper" :style="pageStyle"><div v-for="node in page.children" :key="node.id" class="slide-object" :class="{ selected: selectedId === node.id }" :style="shapeStyle(node)" tabindex="0" @click="select(node)" @keydown.enter.prevent="select(node)"><img v-if="node.kind === 'image' && node.properties.src" class="slide-image" :src="String(node.properties.src)" alt="幻灯片图片" /><span v-else class="slide-text">{{ node.text }}</span></div></div>
    </div>
    <section v-if="selected" class="object-editor">
      <header><span>{{ selected.kind === 'image' ? '已选择图片' : '编辑选中对象' }}</span><button @mousedown.prevent @click="quote">引用到对话</button></header>
      <button v-if="selected.kind === 'image'" class="apply-button" :disabled="busy" @click="replaceImage">替换图片</button>
      <template v-else><textarea v-model="draft" aria-label="选中对象的文字" :disabled="busy" rows="3" @keydown.ctrl.enter.prevent="apply" /><footer><small>仅修改选中的对象，其他内容保持不变</small><button class="apply-button" :disabled="busy || draft === selected.text || !selected.text" @click="apply">应用修改</button></footer></template>
    </section>
    <div v-else class="editor-hint">点击段落、文本框或图片以编辑，也可引用给 AI。</div>
  </div>
</template>
<style scoped>
.office-editor { height: 100%; min-height: 0; display: flex; flex-direction: column; }.office-scroll { overflow: auto; flex: 1; min-height: 0; padding: 24px; background: var(--document-field); }.word-paper { background: #fff; color: #202020; min-height: 720px; max-width: 794px; margin: auto; padding: 48px 42px; box-shadow: 0 2px 12px #0000000d; font: 11pt/1.6 'Microsoft YaHei', sans-serif; }.slide-paper { container-type: inline-size; position: relative; width: 100%; margin: 30px auto; color: #202020; box-shadow: 0 2px 12px #00000014; overflow: hidden; }.slide-object { position: absolute; white-space: pre-wrap; overflow: hidden; cursor: pointer; outline-offset: -1px; line-height: 1.3; }.slide-object:hover { outline: 1px solid #ccc; }.slide-object.selected { outline: 2px solid #e5aa60; }.slide-image { width: 100%; height: 100%; object-fit: fill; }.slide-text { display: block; padding: 3px; }.slide-navigation { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 7px; font-size: 11px; color: var(--document-muted); }.slide-navigation button,.slide-navigation select { background: var(--document-field); border: 0; border-radius: 4px; padding: 4px 8px; color: var(--document-text); }
.object-editor { flex-shrink: 0; border-top: 1px solid var(--document-line); padding: 12px; }.object-editor header,.object-editor footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--document-muted); }.object-editor header button { border: 0; background: transparent; color: inherit; cursor: pointer; }.object-editor textarea { resize: vertical; width: 100%; max-height: 160px; background: var(--document-field); border: 0; border-radius: 5px; margin: 9px 0; padding: 9px; color: var(--document-text); font: 12px/1.6 inherit; }.apply-button { background: var(--document-text); color: var(--document-bg); border: 0; border-radius: 5px; padding: 6px 12px; cursor: pointer; font-size: 11px; }.apply-button:disabled { opacity: .4; cursor: default; }.editor-hint { text-align: center; padding: 11px; font-size: 11px; color: var(--document-muted); }
</style>
