<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { ImageCapabilities } from '../../api/imageGeneration'
import { imageQualityLabel, imageSizeLabel, validImageSize } from '../../../shared/image-model-parameters.mjs'

// 参数面板与比例图形移植自 Toonflow generationSettings.vue（MIT），保留模型驱动选项与交互。
const props = defineProps<{ parameters: ImageCapabilities; disabled?: boolean; compact?: boolean }>()
const size = defineModel<string>('size', { required: true })
const quality = defineModel<string>('quality', { required: true })
const custom = shallowRef(false)
const customSize = computed(() => !props.parameters.sizes.includes(size.value))
const valid = computed(() => validImageSize(size.value, props.parameters))
const experimental = computed(() => {
  const [width = 0, height = 0] = size.value.split('x').map(Number)
  return Boolean(props.parameters.custom_size && width * height > props.parameters.custom_size.experimental_above_pixels)
})
function ratioStyle(value: string) {
  const [width = 1, height = 1] = value.split('x').map(Number)
  return value === 'auto' ? { width: '14px', height: '14px' }
    : { width: 16 * Math.min(width / height, 1) + 'px', height: 16 * Math.min(height / width, 1) + 'px' }
}
function ratioLabel(value: string) {
  if (value === 'auto') return '自动'
  const [width = 1, height = 1] = value.split('x').map(Number)
  return width === height ? '方形' : width > height ? '横向' : '竖向'
}
</script>

<template>
  <div class="image-output-options" :class="{ compact }">
    <template v-if="compact">
      <label class="output-field"><span>尺寸</span><select v-model="size" :disabled="disabled" aria-label="图片尺寸"><option v-for="item in parameters.sizes" :key="item" :value="item">{{ imageSizeLabel(item) }}</option><option v-if="customSize" :value="size">{{ imageSizeLabel(size) }}</option></select></label>
      <label class="output-field"><span>质量</span><select v-model="quality" :disabled="disabled" aria-label="图片质量"><option v-for="item in parameters.qualities" :key="item" :value="item">{{ imageQualityLabel(item) }}</option></select></label>
    </template>
    <template v-else>
      <label class="output-field"><span>画面尺寸</span><select v-model="size" :disabled="disabled" aria-label="图片尺寸"><option v-for="item in parameters.sizes" :key="item" :value="item">{{ imageSizeLabel(item) }}</option><option v-if="customSize" :value="size">{{ imageSizeLabel(size) }}</option></select></label>
      <div class="ratio-options" role="group" aria-label="常用画面比例">
        <button v-for="item in parameters.sizes.slice(0, 4)" :key="item" type="button" class="ratio-button" :disabled="disabled" :aria-pressed="size === item" @click="size = item"><span class="ratio-shape" :style="ratioStyle(item)" aria-hidden="true" /><span>{{ ratioLabel(item) }}</span></button>
      </div>
      <div class="output-field"><span>生成质量</span></div>
      <div class="quality-options" role="group" aria-label="图片质量"><button v-for="item in parameters.qualities" :key="item" type="button" :disabled="disabled" :aria-pressed="quality === item" :title="item" @click="quality = item">{{ imageQualityLabel(item) }}</button></div>
    </template>
    <button v-if="parameters.custom_size" type="button" class="custom-toggle" :disabled="disabled" :aria-expanded="custom || customSize" @click="custom = !custom">自定义尺寸</button>
    <label v-if="parameters.custom_size && (custom || customSize)" class="output-field custom-field"><span>宽 × 高</span><input v-model="size" :disabled="disabled" placeholder="1536x864" aria-label="自定义图片尺寸" :aria-invalid="!valid" @keydown.enter.prevent /></label>
    <small v-if="!valid" class="parameter-warning" role="alert">宽高为 16 的倍数，每边 ≤3840，长宽比 ≤3:1，总像素 655360–8294400。</small>
    <small v-else-if="experimental" class="parameter-note">此尺寸超过 2560 × 1440，属于官方实验性分辨率。</small>
    <small v-if="!parameters.source" class="parameter-note">服务商未返回尺寸与质量元数据，使用接口默认值。</small>
  </div>
</template>

<style scoped>
.image-output-options { display: grid; gap: 10px; min-width: 0; font-size: 12px; }
.output-field { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--image-muted, var(--settings-muted)); min-width: 0; }
.output-field select,.output-field input { min-width: 0; max-width: 180px; border: 1px solid var(--image-line, var(--settings-line)); border-radius: 6px; background: var(--image-field, var(--settings-field)); color: var(--image-text, var(--settings-text)); padding: 6px 8px; font-size: 12px; }
.ratio-options,.quality-options { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 5px; }
.ratio-button,.quality-options button { min-width: 0; border: 1px solid transparent; border-radius: 6px; background: var(--image-field, var(--settings-field)); color: var(--image-muted, var(--settings-muted)); padding: 9px 3px; font-size: 11px; }
.ratio-button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; min-height: 55px; }
.ratio-shape { display: inline-block; flex-shrink: 0; border: 1px solid currentColor; border-radius: 2px; box-sizing: border-box; }
button[aria-pressed=true] { color: var(--image-text, var(--settings-text)); border-color: var(--image-muted, var(--settings-muted)); }
button:hover { color: var(--image-text, var(--settings-text)); }
.custom-toggle { justify-self: start; border: 0; background: none; color: var(--image-muted, var(--settings-muted)); padding: 2px 0; font-size: 11px; }
.custom-field input { width: 130px; }
.parameter-note,.parameter-warning { font-size: 10px; line-height: 1.6; color: var(--image-muted, var(--settings-muted)); }.parameter-warning { color: #cb665c; }
.compact { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; }.compact .output-field { justify-content: flex-start; font-size: 11px; }.compact .output-field select { max-width: 165px; }.compact .parameter-note,.compact .parameter-warning { flex-basis: 100%; }
button:disabled { opacity: .5; cursor: default; }button:focus-visible,input:focus-visible,select:focus-visible { outline: 2px solid var(--image-muted, var(--settings-muted)); outline-offset: 2px; }
</style>
