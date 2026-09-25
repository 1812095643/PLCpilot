<script setup lang="ts">
import { computed } from 'vue'
import { IconSparkles, IconPhoto, IconArrowUpRight } from '@tabler/icons-vue'
import type { ImageGenerationProgress } from '../../api/imageGeneration'
const props = defineProps<{ progress: ImageGenerationProgress }>()
const emit = defineEmits<{ open: [path: string] }>()
const pending = computed(() => props.progress.status === 'generating' || props.progress.status === 'partial')
const label = computed(() => ({ generating: '正在生成图片', partial: '图片正在逐步呈现', completed: '图片已生成', cancelled: '已停止生成', error: '图片暂未生成' }[props.progress.status]))
</script>
<template>
  <section class="image-generation-card" :class="{ pending }" :aria-busy="pending">
    <button v-if="progress.path && progress.image_url" class="image-result" aria-label="查看生成图片" @click="emit('open', progress.path)"><img :src="progress.image_url" alt="生成的图片" /><span class="image-open"><IconArrowUpRight />查看图片</span></button>
    <div v-else class="image-generation-canvas"><img v-if="progress.image_url" :src="progress.image_url" alt="生成中的真实中间预览" class="partial-image" /><div v-else class="image-generation-symbol"><IconSparkles v-if="pending" /><IconPhoto v-else /></div><div v-if="pending" class="image-shimmer" aria-hidden="true" /><div v-if="pending" class="image-grain" aria-hidden="true" /></div>
    <footer><span class="image-generation-label" role="status">{{ label }}</span><span>{{ progress.model }}</span></footer><p v-if="progress.error" class="image-generation-error">{{ progress.error }}</p>
  </section>
</template>
<style scoped>
.image-generation-card { width: min(100%, 420px); margin: 8px 0 12px; }.image-generation-canvas,.image-result { position: relative; display: grid; place-items: center; overflow: hidden; width: 100%; aspect-ratio: 4 / 3; border-radius: 14px; background: #ededed; isolation: isolate; }.image-result { border: 0; padding: 0; cursor: zoom-in; height: auto; aspect-ratio: auto; }.image-result img { display: block; width: 100%; max-height: 540px; object-fit: contain; animation: image-reveal .6s ease-out; }.partial-image { width: 100%; height: 100%; object-fit: contain; animation: image-reveal .65s ease-out; }.image-generation-symbol { color: #a6a6a6; }.image-generation-symbol svg { width: 35px; height: 35px; stroke-width: 1.1; }.image-shimmer { position: absolute; inset: -60%; pointer-events: none; background: conic-gradient(from 20deg, transparent, #ffffff85, transparent 35%, #d2d2d22b, transparent); animation: image-current 8s linear infinite; mix-blend-mode: soft-light; }.image-grain { position: absolute; inset: 0; opacity: .18; background-image: radial-gradient(#888 0.55px, transparent 0.8px); background-size: 4px 4px; pointer-events: none; }.image-generation-card footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 9px; font-size: 10px; color: #999; }.image-generation-label { color: #777; font-size: 12px; }.pending .image-generation-label { animation: image-breathe 3s ease-in-out infinite; }.image-open { position: absolute; right: 10px; bottom: 10px; background: #222b; color: #fff; padding: 6px 9px; border-radius: 7px; font-size: 11px; display: flex; gap: 5px; align-items: center; }.image-open svg { width: 14px; height: 14px; }.image-generation-error { font-size: 11px; color: #c46a5d; line-height: 1.7; }
:global(.dark .image-generation-canvas) { background: #2b2b2b; }:global(.dark .image-generation-label) { color: #b8b8b8; }
@keyframes image-current { to { transform: rotate(360deg); } }@keyframes image-breathe { 50% { opacity: .55; } }@keyframes image-reveal { from { opacity: .3; filter: blur(6px); } to { opacity: 1; filter: blur(0); } }
@media(prefers-reduced-motion:reduce) { .image-shimmer,.pending .image-generation-label,.partial-image,.image-result img { animation: none; } }
</style>
