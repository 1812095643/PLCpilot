<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import { getImageSettings, saveImageSettings, moveModelToImage, moveModelToChat, type ModelTransferResult, type ImageSettings, type ImageModel } from '../../api/imageGeneration'
import type { ModelSummary } from '../../api/plcBridge'
import { imageParameters } from '../../../shared/image-model-parameters.mjs'
import ImageOutputOptions from '../images/ImageOutputOptions.vue'

export type ImageModelSettingsExposed = { moveToImage: (id: string) => Promise<boolean> }
const props = defineProps<{ providerId: string; chatModels: ModelSummary[]; disabled?: boolean }>()
const emit = defineEmits<{ 'models-transferred': [result: ModelTransferResult]; loaded: [settings: ImageSettings]; busy: [value: boolean] }>()
const settings = shallowRef<ImageSettings>({ models: [], default_id: '' })
const busy = shallowRef(true), error = shallowRef(''), notice = shallowRef('')
const dirty = shallowRef(false)
const blocked = computed(() => busy.value || props.disabled)
const models = computed(() => settings.value.models.filter(model => model.provider_id === props.providerId))
const requestModels = computed(() => [...new Map(props.chatModels.map(model => [model.model, { id: model.model, name: model.name || model.model }])).values()])
watch(busy, value => emit('busy', value), { immediate: true })
onMounted(async () => {
  try { settings.value = await getImageSettings(); emit('loaded', settings.value) }
  catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
})

function update(id: string, changes: Partial<ImageModel>) {
  settings.value = { ...settings.value, models: settings.value.models.map(model => {
    if (model.id !== id) return model
    return { ...model, ...changes }
  }) }
  dirty.value = true
  notice.value = ''
}
function remove(id: string) { settings.value = { ...settings.value, models: settings.value.models.filter(model => model.id !== id) }; dirty.value = true }
function setDefault(id: string) { settings.value = { ...settings.value, default_id: id }; dirty.value = true }
async function save() {
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const current = await getImageSettings()
    // 各服务商只保存自己的模型，保留其他配置页或工作台刚刚保存的内容。
    settings.value = await saveImageSettings({ models: [...current.models.filter(model => model.provider_id !== props.providerId), ...models.value],
      default_id: models.value.some(model => model.id === settings.value.default_id) ? settings.value.default_id : current.default_id })
    dirty.value = false
    emit('loaded', settings.value)
    notice.value = '已保存'
    return true
  } catch (cause) { error.value = String(cause); return false }
  finally { busy.value = false }
}
async function transfer(id: string, target: 'image' | 'chat'): Promise<boolean> {
  if (busy.value || props.disabled) return false
  if (dirty.value && !await save()) return false
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const result = await (target === 'image' ? moveModelToImage(id) : moveModelToChat(id))
    settings.value = result.images
    emit('loaded', settings.value)
    emit('models-transferred', result)
    notice.value = target === 'image' ? '已移至生图模型' : '已移至对话模型'
    return true
  } catch (cause) { error.value = String(cause); return false }
  finally { busy.value = false }
}
defineExpose<ImageModelSettingsExposed>({ moveToImage: id => transfer(id, 'image') })
</script>

<template>
  <section class="image-model-settings">
    <header class="image-settings-heading"><h3>生图模型</h3></header>
    <div v-for="model in models" :key="model.id" class="image-model-row">
      <div class="image-model-main">
        <input type="checkbox" :checked="model.enabled" :disabled="blocked" :aria-label="'启用生图模型 ' + model.model" @change="update(model.id, { enabled: ($event.target as HTMLInputElement).checked })" />
        <strong class="model-name" :title="model.model">{{ model.name || model.model }}</strong>
        <button class="image-text-button" :disabled="blocked" @click="transfer(model.id, 'chat')">转为对话模型</button>
        <button class="image-text-button" :class="{ 'is-default': settings.default_id === model.id }" :disabled="blocked || !model.enabled" @click="setDefault(model.id)">{{ settings.default_id === model.id ? '默认' : '设为默认' }}</button><button class="image-text-button" :disabled="blocked" @click="remove(model.id)">移除</button>
      </div>
      <div class="image-model-options">
        <label class="image-protocol">协议<select :value="model.protocol" :disabled="blocked" @change="update(model.id, { protocol: ($event.target as HTMLSelectElement).value as ImageModel['protocol'] })"><option value="images">Images API</option><option value="responses">Responses API</option></select></label>
        <ImageOutputOptions compact :parameters="imageParameters(model.model, model.parameters)" :size="model.size" :quality="model.quality" :disabled="blocked" @update:size="update(model.id, { size: $event })" @update:quality="update(model.id, { quality: $event })" />
      </div>
      <div class="image-stream-row"><label class="image-stream-checkbox"><input type="checkbox" :checked="model.streaming" :disabled="blocked" @change="update(model.id, { streaming: ($event.target as HTMLInputElement).checked })" />实时中间图</label><small>仅在服务商支持流式生图时启用</small></div>
      <label v-if="model.protocol === 'responses'" class="request-model">调用工具的对话模型<select :value="model.request_model ?? ''" :disabled="blocked" @change="update(model.id, { request_model: ($event.target as HTMLSelectElement).value })"><option value="" disabled>选择对话模型</option><option v-if="model.request_model && !requestModels.some(item => item.id === model.request_model)" :value="model.request_model">{{ model.request_model }}</option><option v-for="candidate in requestModels" :key="candidate.id" :value="candidate.id">{{ candidate.name || candidate.id }}</option></select></label>
    </div>
    <p v-if="!models.length" class="image-setting-hint">在上方对话模型中点击「设为生图模型」即可移入。</p>
    <footer v-if="dirty || models.length"><button class="settings-command" :disabled="blocked || !dirty" @click="save">{{ busy ? '保存中…' : '保存生图配置' }}</button><span role="status">{{ notice || (dirty ? '有未保存的修改' : '') }}</span></footer>
    <p v-if="error" role="alert" class="image-model-error">{{ error }}</p>
  </section>
</template>

<style scoped>
.image-model-settings { border-top: 1px solid var(--settings-line); padding-top: 18px; display: grid; gap: 12px; min-width: 0; }
.image-settings-heading,.image-settings-actions,.image-model-main,.image-stream-row { display: flex; align-items: center; gap: 10px; min-width: 0; }.image-settings-heading { justify-content: space-between; }.image-settings-heading h3 { margin: 0; font-size: 14px; font-weight: 550; }
.image-model-row { display: grid; gap: 12px; padding: 10px 0 16px; border-bottom: 1px solid var(--settings-line); min-width: 0; }
.image-model-main .model-name { flex: 1; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; }
.image-text-button { border: 0; background: none; color: var(--settings-muted); cursor: pointer; font-size: 11px; white-space: nowrap; padding: 3px; }.is-default { color: var(--settings-text); }
.image-model-options { display: flex; align-items: start; flex-wrap: wrap; gap: 10px 16px; }.image-protocol,.request-model,.image-stream-checkbox { display: flex; align-items: center; gap: 7px; color: var(--settings-muted); font-size: 11px; min-width: 0; }.request-model select { flex: 1; min-width: 0; }
.image-model-settings input:not([type=checkbox]),.image-model-settings select { background: var(--settings-field); color: var(--settings-text); border: 1px solid var(--settings-line); border-radius: 6px; padding: 6px 8px; font-size: 12px; }
.image-stream-row { flex-wrap: wrap; gap: 6px 12px; }.image-stream-row small,.image-setting-hint { color: var(--settings-muted); font-size: 11px; }.image-setting-hint { margin: 0; line-height: 1.6; }
.image-manual-add { display: flex; gap: 8px; }.image-manual-add input { flex: 1; min-width: 0; }
.image-model-settings footer { display: flex; gap: 12px; align-items: center; font-size: 11px; color: var(--settings-muted); }.image-model-error { color: #c8645d; font-size: 12px; line-height: 1.6; margin: 0; overflow-wrap: anywhere; }
input[type=checkbox] { flex-shrink: 0; width: 14px; height: 14px; margin: 0; accent-color: #007acc; }button:disabled { opacity: .5; cursor: default; }button:focus-visible,input:focus-visible,select:focus-visible { outline: 2px solid var(--settings-muted); outline-offset: 2px; }
</style>
