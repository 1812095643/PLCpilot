<script setup lang="ts">
import { computed } from 'vue'
import { IconPhoto, IconDownload, IconFolder, IconPhotoPlus, IconRotateClockwise, IconCopy, IconMaximize } from '@tabler/icons-vue'
import { openLocalPath } from '../../api/plcBridge'
import { saveImageStudioResult } from '../../api/imageGeneration'
import type { ImageGenerationProgress } from '../../api/imageGeneration'
import ImageGenerationCard from '../content/ImageGenerationCard.vue'
import { imageQualityLabel } from '../../../shared/image-model-parameters.mjs'

const props = defineProps<{ record: ImageGenerationProgress | null; imageUrl: string; loading: boolean }>()
const emit = defineEmits<{ preview: [path: string]; reference: [path: string]; reuse: [record: ImageGenerationProgress]; notice: [text: string] }>()
const progress = computed(() => props.record ? { ...props.record, image_url: props.imageUrl || undefined } : null)
async function action(type: 'save' | 'reveal' | 'copy') {
  if (!props.record) return
  try {
    if (type === 'save') { const path = await saveImageStudioResult(props.record.id); if (path) emit('notice', '图片已另存') }
    if (type === 'reveal' && props.record.path) await openLocalPath(props.record.path, 'reveal')
    if (type === 'copy') { await navigator.clipboard.writeText(props.record.prompt ?? ''); emit('notice', '已复制提示词') }
  } catch (error) { emit('notice', String(error)) }
}
</script>

<template>
  <section class="image-studio-result">
    <div v-if="record" class="image-result-toolbar"><span class="result-model">{{ record.model }}<small v-if="record.width && record.height">{{ record.width }} × {{ record.height }} · {{ imageQualityLabel(record.quality || 'auto') }}</small></span><div class="result-actions"><button title="复制提示词" aria-label="复制提示词" @click="action('copy')"><IconCopy /></button><button title="使用这份提示词" aria-label="使用这份提示词" @click="emit('reuse', record)"><IconRotateClockwise /></button><template v-if="record.path"><button title="用作参考图" aria-label="用作参考图" @click="emit('reference', record.path)"><IconPhotoPlus /></button><button title="在文件夹中显示" aria-label="在文件夹中显示" @click="action('reveal')"><IconFolder /></button><button title="另存图片" aria-label="另存图片" @click="action('save')"><IconDownload /></button><button title="查看原图" aria-label="查看原图" @click="emit('preview', record.path)"><IconMaximize /></button></template></div></div>
    <div class="image-result-stage">
      <ImageGenerationCard v-if="progress" :progress="progress" class="studio-generation-card" @open="emit('preview', $event)" />
      <div v-else class="image-studio-empty"><div class="empty-image-frame"><IconPhoto /></div><p>从一个画面想法开始</p><small>输入描述，或添加参考图片</small></div>
      <span v-if="loading" class="image-loading-note" role="status">正在读取原图…</span>
    </div>
    <p v-if="record?.prompt" class="result-prompt" :title="record.prompt">{{ record.prompt }}</p>
  </section>
</template>

<style scoped>
.image-studio-result { display: flex; flex-direction: column; min-width: 0; min-height: 0; position: relative; }
.image-result-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 52px; padding: 10px 20px; }
.result-model { display: grid; gap: 4px; min-width: 0; color: var(--image-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.result-model small { font-size: 10px; opacity: .8; }.result-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.result-actions button { display: grid; place-items: center; width: 28px; height: 28px; padding: 6px; border: 0; border-radius: 5px; color: var(--image-muted); background: none; }.result-actions button:hover { color: var(--image-text); background: var(--image-field); }.result-actions svg { width: 15px; height: 15px; }
.image-result-stage { flex: 1; min-height: 100px; display: grid; place-items: center; overflow: auto; padding: 18px 28px; position: relative; }
.studio-generation-card { width: min(100%, 580px); margin: 0; --image-result-height: min(54vh, 580px); --image-pending-height: min(46vh, 500px); }
.image-studio-empty { display: grid; justify-items: center; gap: 9px; color: var(--image-muted); margin: auto; }.empty-image-frame { display: grid; place-items: center; width: 174px; height: 124px; margin-bottom: 14px; border-radius: 12px; background: var(--image-field); background-image: radial-gradient(var(--image-line) .6px,transparent .6px); background-size: 8px 8px; }.empty-image-frame svg { width: 34px; height: 34px; stroke-width: 1.15; color: var(--image-muted); opacity: .7; }.image-studio-empty p { margin: 0; font-size: 15px; color: var(--image-text); font-weight: 450; }.image-studio-empty small { font-size: 12px; }
.result-prompt { padding: 0 24px 18px; margin: 0; color: var(--image-muted); font-size: 11px; line-height: 1.7; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; max-height: 56px; }
.image-loading-note { position: absolute; bottom: 6px; font-size: 11px; color: var(--image-muted); }
button:focus-visible { outline: 2px solid var(--image-muted); outline-offset: 2px; }
@media(max-width:1000px) { .image-result-toolbar { flex-wrap: wrap; padding: 10px 14px; }.image-result-stage { padding: 14px; }.result-actions { margin-left: auto; } }
</style>
