<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { DocumentSnapshot } from '../../api/documents'
const props = defineProps<{ document: DocumentSnapshot }>()
const zoom = shallowRef(100)
const rotation = shallowRef(0)
const transform = computed(() => ({ transform: `scale(${zoom.value / 100}) rotate(${rotation.value}deg)` }))
function scale(delta: number) { zoom.value = Math.max(25, Math.min(400, zoom.value + delta)) }
let lastPoint: { x: number; y: number } | null = null
function start(event: PointerEvent) { if (event.button !== 0) return; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); lastPoint = { x: event.clientX, y: event.clientY } }
function move(event: PointerEvent) { if (!lastPoint) return; const host = event.currentTarget as HTMLElement; host.scrollBy(lastPoint.x - event.clientX, lastPoint.y - event.clientY); lastPoint = { x: event.clientX, y: event.clientY } }
</script>

<template>
  <div class="image-preview">
    <div class="image-tools"><button aria-label="缩小" @click="scale(-25)">−</button><button @click="zoom = 100; rotation = 0">{{ zoom }}%</button><button aria-label="放大" @click="scale(25)">＋</button><span class="image-tool-separator" /><button @click="rotation = (rotation + 90) % 360">旋转视图</button></div>
    <div class="image-canvas" @pointerdown="start" @pointermove="move" @pointerup="lastPoint = null" @pointercancel="lastPoint = null" @lostpointercapture="lastPoint = null" @wheel.ctrl.prevent="scale($event.deltaY < 0 ? 10 : -10)">
      <img class="preview-image" :src="props.document.image_url ?? ''" :alt="props.document.name" :style="transform" draggable="false" />
    </div>
    <div class="image-caption">Ctrl + 滚轮缩放 · 拖动查看 · 旋转仅改变视图</div>
  </div>
</template>

<style scoped>
.image-preview { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.image-tools { display: flex; align-items: center; justify-content: center; gap: 5px; padding: 10px; flex-shrink: 0; }
.image-tools button { border: 0; background: transparent; color: var(--document-muted); padding: 5px 10px; font-size: 12px; border-radius: 5px; cursor: pointer; }.image-tools button:hover { background: var(--document-field); color: var(--document-text); }
.image-tool-separator { height: 15px; width: 1px; background: var(--document-line); margin: 0 4px; }
.image-canvas { flex: 1; min-height: 0; overflow: auto; display: grid; place-items: center; padding: 35px; cursor: grab; touch-action: none; }.image-canvas:active { cursor: grabbing; }
.preview-image { max-width: 100%; max-height: 100%; object-fit: contain; transform-origin: center; transition: transform 180ms ease-out; user-select: none; box-shadow: 0 4px 25px #00000014; }
.image-caption { text-align: center; color: var(--document-muted); font-size: 10px; padding: 12px; }
@media(prefers-reduced-motion: reduce) { .preview-image { transition: none; } }
</style>
