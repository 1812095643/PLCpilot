<script setup lang="ts">
import { IconPhoto, IconSettings, IconRefresh, IconX } from '@tabler/icons-vue'
import type { ImageStudio } from '../../composables/useImageStudio'
import ImageStudioPrompt from './ImageStudioPrompt.vue'
import ImageStudioResult from './ImageStudioResult.vue'
import ImageStudioHistory from './ImageStudioHistory.vue'
defineProps<{ studio: ImageStudio }>()
const emit = defineEmits<{ configure: []; preview: [path: string]; notice: [text: string] }>()
</script>
<template>
  <section class="image-studio">
    <header class="studio-header"><span class="studio-title"><IconPhoto />生图</span><div class="studio-header-actions"><button :disabled="studio.loading.value" title="刷新模型和历史" aria-label="刷新模型和历史" @click="studio.reload"><IconRefresh :class="{ refreshing: studio.loading.value }" /></button><button title="生图模型设置" aria-label="生图模型设置" @click="emit('configure')"><IconSettings /></button></div></header>
    <div v-if="studio.error.value" class="studio-error" role="alert"><span>{{ studio.error.value }}</span><button title="关闭提示" aria-label="关闭提示" @click="studio.error.value = ''"><IconX /></button></div>
    <div class="studio-body">
      <ImageStudioPrompt :studio="studio" @configure="emit('configure')" @preview="emit('preview', $event)" />
      <div class="studio-output"><ImageStudioResult :record="studio.selected.value" :image-url="studio.imageUrl.value" :loading="studio.previewLoading.value" @preview="emit('preview', $event)" @reference="studio.attachPaths([$event])" @reuse="studio.reuse" @notice="emit('notice', $event)" /><ImageStudioHistory :records="studio.records.value" :selected-id="studio.selected.value?.id ?? ''" @select="studio.selectedId.value = $event" /></div>
    </div>
  </section>
</template>
<style scoped>
.image-studio { --image-bg: #fff; --image-field: #f4f4f4; --image-text: #303030; --image-muted: #828282; --image-line: #e7e7e7; display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; background: var(--image-bg); color: var(--image-text); }
:global(.dark .image-studio) { --image-bg: #1e1e1e; --image-field: #292929; --image-text: #e2e2e2; --image-muted: #969696; --image-line: #353535; }
.studio-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 46px; padding: 0 20px; border-bottom: 1px solid var(--image-line); }.studio-title { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 550; }.studio-title svg { width: 17px; height: 17px; stroke-width: 1.6; }.studio-header-actions { display: flex; gap: 4px; }
.studio-header-actions button,.studio-error button { display: grid; place-items: center; width: 28px; height: 28px; padding: 6px; border: 0; border-radius: 5px; color: var(--image-muted); background: none; }.studio-header-actions button:hover { background: var(--image-field); }.studio-header-actions svg,.studio-error svg { width: 16px; height: 16px; }.refreshing { animation: studio-refresh 1.8s linear infinite; }
.studio-body { display: grid; grid-template-columns: minmax(240px, 290px) minmax(0, 1fr); flex: 1; min-height: 0; min-width: 0; }.studio-body > :first-child { border-right: 1px solid var(--image-line); }.studio-output { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-width: 0; min-height: 0; }
.studio-error { display: flex; align-items: center; gap: 10px; padding: 8px 16px; color: #c9655b; border-bottom: 1px solid var(--image-line); font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }.studio-error span { flex: 1; min-width: 0; }
button:disabled { opacity: .4; cursor: default; }button:focus-visible { outline: 2px solid var(--image-muted); outline-offset: 2px; }
@keyframes studio-refresh { to { transform: rotate(360deg); } }
@media(max-width:1050px) { .studio-body { grid-template-columns: 246px minmax(0,1fr); } }
@media(max-width:700px) { .studio-body { grid-template-columns: 1fr; overflow-y: auto; }.studio-body > :first-child { min-height: 560px; border-right: 0; border-bottom: 1px solid var(--image-line); }.studio-output { min-height: 460px; } }
@media(prefers-reduced-motion:reduce) { .refreshing { animation: none; } }
</style>
