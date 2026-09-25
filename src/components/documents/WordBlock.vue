<script setup lang="ts">
import type { DocumentNode } from '../../api/documents'
defineProps<{ node: DocumentNode; selected: string }>()
const emit = defineEmits<{ select: [node: DocumentNode] }>()
function runStyle(node: DocumentNode) { return { fontWeight: node.properties.bold ? '700' : undefined, fontStyle: node.properties.italic ? 'italic' : undefined, textDecoration: node.properties.underline ? 'underline' : undefined, fontSize: node.properties.font_size ? `${node.properties.font_size}pt` : undefined, color: String(node.properties.color ?? 'inherit') } }
</script>
<template>
  <div v-if="node.kind === 'table'" class="word-table"><WordBlock v-for="child in node.children" :key="child.id" :node="child" :selected="selected" @select="emit('select', $event)" /></div>
  <div v-else-if="node.kind === 'row'" class="word-row"><WordBlock v-for="child in node.children" :key="child.id" :node="child" :selected="selected" @select="emit('select', $event)" /></div>
  <div v-else-if="node.kind === 'cell'" class="word-cell"><WordBlock v-for="child in node.children" :key="child.id" :node="child" :selected="selected" @select="emit('select', $event)" /></div>
  <p v-else class="word-paragraph" :class="{ selected: selected === node.id, heading: String(node.properties.style ?? '').toLowerCase().includes('heading') }" :style="{ textAlign: node.properties.align === 'both' ? 'justify' : String(node.properties.align || 'left') as 'left' }" tabindex="0" @click="emit('select', node)" @keydown.enter.prevent="emit('select', node)">
    <span v-if="node.properties.list" class="word-bullet">• </span>
    <template v-for="run in node.children" :key="run.id"><img v-if="run.kind === 'image'" class="word-image" :class="{ selected: selected === run.id }" :src="String(run.properties.src)" alt="文档图片" @click.stop="emit('select', run)" /><span v-else :style="runStyle(run)">{{ run.text }}</span></template>
    <span v-if="!node.children.length">{{ node.text || '\u00a0' }}</span>
  </p>
</template>
<style scoped>
.word-paragraph { margin: 0 0 10pt; line-height: 1.65; white-space: pre-wrap; cursor: text; border-radius: 2px; outline-offset: 3px; overflow-wrap: anywhere; }.word-paragraph:hover { outline: 1px solid #d2d2d2; }.word-paragraph.selected { outline: 1.5px solid #d9a35c; }.word-paragraph.heading { font-size: 18pt; font-weight: 600; }.word-table { display: table; width: 100%; border-collapse: collapse; margin: 14pt 0; }.word-row { display: table-row; }.word-cell { display: table-cell; border: 1px solid #ccc; padding: 7pt; vertical-align: top; }.word-cell>.word-paragraph:last-child { margin-bottom: 0; }.word-image { max-width: 100%; display: block; margin: 8px 0; }.word-image.selected { outline: 2px solid #d9a35c; }.word-bullet { color: #888; }
</style>
