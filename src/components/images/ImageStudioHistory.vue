<script setup lang="ts">
import { IconLoader2, IconPhoto, IconExclamationCircle } from '@tabler/icons-vue'
import type { ImageGenerationProgress } from '../../api/imageGeneration'
defineProps<{ records: ImageGenerationProgress[]; selectedId: string }>()
const emit = defineEmits<{ select: [id: string] }>()
</script>
<template>
  <section class="image-studio-history" aria-label="生图历史">
    <span class="history-label">最近生成</span>
    <div class="history-items"><button v-for="record in records" :key="record.id" class="history-item" :class="{ selected: selectedId === record.id, pending: ['generating', 'partial'].includes(record.status) }" :title="record.prompt || record.model" :aria-label="record.model + ' · ' + (record.prompt || '生成图片')" :aria-pressed="selectedId === record.id" @click="emit('select', record.id)"><img v-if="record.thumbnail_url || record.image_url" :src="record.thumbnail_url || record.image_url" :alt="record.prompt || '生成图片'" loading="lazy" /><IconLoader2 v-else-if="['generating', 'partial'].includes(record.status)" class="history-spinner" /><IconExclamationCircle v-else-if="record.status === 'error'" /><IconPhoto v-else /><span v-if="record.status === 'cancelled'" class="history-status">已停止</span></button><p v-if="!records.length" class="history-empty">生成的图片会保存在这里</p></div>
  </section>
</template>
<style scoped>
.image-studio-history { display: flex; flex-direction: column; gap: 10px; padding: 14px 20px 16px; border-top: 1px solid var(--image-line); min-width: 0; }.history-label { font-size: 11px; color: var(--image-muted); }.history-items { display: flex; gap: 8px; overflow-x: auto; min-width: 0; min-height: 64px; align-items: center; }
.history-item { position: relative; flex: 0 0 76px; width: 76px; height: 64px; display: grid; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 7px; overflow: hidden; background: var(--image-field); color: var(--image-muted); transition: opacity 180ms ease, transform 180ms ease; }.history-item:hover { transform: translateY(-2px); }.history-item.selected { border-color: var(--image-muted); }.history-item img { width: 100%; height: 100%; object-fit: cover; }.history-item svg { width: 21px; height: 21px; stroke-width: 1.4; }.history-status { position: absolute; inset: auto 0 0; background: #2229; color: #eee; font-size: 9px; text-align: center; padding: 2px; }.history-empty { color: var(--image-muted); font-size: 11px; margin: 0; opacity: .75; }.history-spinner { animation: image-history-spin 1.8s linear infinite; }
button:focus-visible { outline: 2px solid var(--image-muted); outline-offset: 2px; }
@keyframes image-history-spin { to { transform: rotate(360deg); } }
@media(prefers-reduced-motion:reduce) { .history-item { transition: none; }.history-spinner { animation: none; } }
</style>
