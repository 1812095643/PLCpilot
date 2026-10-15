<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { IconPhotoPlus, IconSparkles, IconPlayerStop } from '@tabler/icons-vue'
import type { ImageStudio } from '../../composables/useImageStudio'
import ComposerAttachmentStrip from '../content/ComposerAttachmentStrip.vue'
import ImageOutputOptions from './ImageOutputOptions.vue'

const props = defineProps<{ studio: ImageStudio }>()
const emit = defineEmits<{ configure: []; preview: [path: string] }>()
const { prompt, modelId, models, providers, parameters, size, quality, busy, canSubmit, cancelling, attachments } = props.studio
const picker = useTemplateRef<HTMLInputElement>('picker')
const groups = computed(() => providers.value.map(provider => ({ provider, models: models.value.filter(model => model.provider_id === provider.id) })).filter(group => group.models.length))
function pick(event: Event) {
  const input = event.target as HTMLInputElement
  props.studio.attachFiles(Array.from(input.files ?? []))
  input.value = ''
}
function shortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) {
    event.preventDefault()
    if (canSubmit.value) void props.studio.generate()
  }
}
</script>

<template>
  <form class="image-studio-prompt" @submit.prevent="studio.generate" @paste="studio.paste" @keydown="shortcut">
    <label class="prompt-label" for="image-studio-prompt">画面描述</label>
    <textarea id="image-studio-prompt" v-model="prompt" placeholder="描述想要的画面，也可以添加图片来修改…" maxlength="32000" spellcheck="false" />
    <div class="reference-toolbar"><button type="button" class="reference-add" @click="picker?.click()"><IconPhotoPlus />参考图片<span>{{ attachments.attachments.value.length }}/8</span></button><input ref="picker" type="file" multiple accept="image/png,image/jpeg,image/webp" hidden @change="pick" /></div>
    <ComposerAttachmentStrip :attachments="attachments.attachments.value" @remove="attachments.removeAttachment" @preview="$event.sourcePath && emit('preview', $event.sourcePath)" />
    <div class="studio-form-options">
      <label class="studio-model-field"><span>模型</span><select v-model="modelId" :disabled="busy || !models.length" aria-label="生图模型"><option v-if="!models.length" value="">尚未配置生图模型</option><optgroup v-for="group in groups" :key="group.provider.id" :label="group.provider.name"><option v-for="model in group.models" :key="model.id" :value="model.id">{{ model.name || model.model }}{{ model.protocol === 'responses' ? ' · Responses' : '' }}</option></optgroup></select></label>
      <button v-if="!models.length" type="button" class="setup-link" @click="emit('configure')">去设置中选择模型</button>
      <ImageOutputOptions v-else v-model:size="size" v-model:quality="quality" :parameters="parameters" :disabled="busy" />
    </div>
    <div class="studio-submit-row"><button v-if="busy" type="button" class="studio-generate studio-stop" :disabled="cancelling || !studio.running.value" @click="studio.cancel"><IconPlayerStop />{{ cancelling ? '正在停止…' : '停止生成' }}</button><button v-else type="submit" class="studio-generate" :disabled="!canSubmit"><IconSparkles />生成图片</button><small>{{ busy ? '生成中，切换页面不影响任务' : 'Ctrl + Enter 生成' }}</small></div>
  </form>
</template>

<style scoped>
.image-studio-prompt { display: flex; flex-direction: column; gap: 11px; height: 100%; min-height: 0; overflow-y: auto; padding: 20px; font-size: 12px; --composer-border: var(--image-line); --composer-soft: var(--image-field); --composer-fg: var(--image-text); --composer-muted: var(--image-muted); }
.prompt-label { color: var(--image-text); font-size: 12px; font-weight: 550; }
textarea { width: 100%; min-height: 142px; max-height: 320px; resize: vertical; border: 1px solid var(--image-line); border-radius: 9px; background: var(--image-field); padding: 11px 12px; color: var(--image-text); line-height: 1.85; font-size: 13px; }
textarea::placeholder { color: var(--image-muted); }textarea:focus { outline: none; border-color: var(--image-muted); }
.reference-toolbar { display: flex; align-items: center; }.reference-add { display: inline-flex; align-items: center; gap: 7px; padding: 3px 0; color: var(--image-muted); border: 0; background: none; font-size: 11px; }.reference-add svg { width: 16px; height: 16px; }.reference-add span { margin-left: 3px; font-size: 10px; opacity: .75; }
.studio-form-options { display: grid; gap: 16px; padding-top: 14px; border-top: 1px solid var(--image-line); }.studio-model-field { display: grid; gap: 8px; color: var(--image-muted); }.studio-model-field select { width: 100%; min-width: 0; padding: 8px; border: 1px solid var(--image-line); border-radius: 6px; color: var(--image-text); background: var(--image-field); font-size: 12px; text-overflow: ellipsis; }
.setup-link { color: var(--image-text); text-align: left; text-decoration: underline; text-underline-offset: 4px; background: none; border: 0; padding: 0; font-size: 12px; }
.studio-submit-row { display: grid; gap: 8px; margin-top: auto; padding-top: 16px; text-align: center; }.studio-submit-row small { color: var(--image-muted); font-size: 10px; }
.studio-generate { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 37px; border: 0; border-radius: 8px; background: var(--image-text); color: var(--image-bg); font-size: 12px; font-weight: 550; transition: opacity 180ms ease, transform 180ms ease; }.studio-generate svg { width: 16px; height: 16px; }.studio-generate:active { transform: scale(.985); }.studio-generate:disabled { opacity: .35; cursor: default; }.studio-stop { background: var(--image-field); color: var(--image-text); box-shadow: inset 0 0 0 1px var(--image-line); }
:deep(.composer-attachment-strip) { display: grid; grid-template-columns: minmax(0,1fr); padding: 0; gap: 5px; }
:deep(.composer-attachment) { padding: 5px 7px; border-radius: 6px; }
button:focus-visible,select:focus-visible { outline: 2px solid var(--image-muted); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .studio-generate { transition: none; } }
</style>
