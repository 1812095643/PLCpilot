<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { getImageSettings, saveImageSettings, type ImageSettings, type ImageModel } from '../../api/imageGeneration'
import type { DiscoveredModel } from '../../api/plcBridge'
import { imageParameters, validImageSize } from '../../../shared/image-model-parameters.mjs'
import ModelDiscoveryList from './ModelDiscoveryList.vue'
import ImageOutputOptions from '../images/ImageOutputOptions.vue'

const props = defineProps<{ providerId: string; availableModels: DiscoveredModel[] }>()
const settings = shallowRef<ImageSettings>({ models: [], default_id: '' })
const busy = shallowRef(false), error = shallowRef(''), notice = shallowRef('')
const pickerOpen = shallowRef(false), manualOpen = shallowRef(false), manualId = shallowRef(''), dirty = shallowRef(false)
const models = computed(() => settings.value.models.filter(model => model.provider_id === props.providerId))
const addedIds = computed(() => models.value.map(model => model.model))
const requestModels = computed(() => props.availableModels.filter(model => !model.image_parameters && !/gpt-image|dall-e/iu.test(model.id)))
onMounted(async () => { try { settings.value = await getImageSettings() } catch (cause) { error.value = String(cause) } })

function addModels(candidates: DiscoveredModel[]) {
  const additions = candidates.filter(candidate => !addedIds.value.includes(candidate.id)).map(candidate => {
    const caps = imageParameters(candidate.id, candidate.image_parameters)
    return { id: crypto.randomUUID(), provider_id: props.providerId, model: candidate.id, protocol: 'images' as const,
      size: caps.sizes[0] ?? 'auto', quality: caps.qualities[0] ?? 'auto', parameters: caps, streaming: false, enabled: true }
  })
  if (!additions.length) return
  settings.value = { ...settings.value, models: [...settings.value.models, ...additions], default_id: settings.value.default_id || additions[0]!.id }
  dirty.value = true
  notice.value = ''
}
function addManual() {
  const id = manualId.value.trim()
  if (!id) return
  addModels([{ id, name: id, owned_by: null }])
  manualId.value = ''
}
function update(id: string, changes: Partial<ImageModel>) {
  settings.value = { ...settings.value, models: settings.value.models.map(model => {
    if (model.id !== id) return model
    const next = { ...model, ...changes }
    if (changes.model !== undefined) {
      const caps = imageParameters(changes.model, props.availableModels.find(item => item.id === changes.model)?.image_parameters)
      next.parameters = caps
      if (!validImageSize(next.size, caps)) next.size = caps.sizes[0] ?? 'auto'
      if (!caps.qualities.includes(next.quality)) next.quality = caps.qualities[0] ?? 'auto'
    }
    return next
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
    notice.value = '已保存'
  } catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}
</script>

<template>
  <section class="image-model-settings">
    <header class="image-settings-heading"><h3>生图模型</h3><div class="image-settings-actions"><button class="settings-command" :disabled="busy" :aria-expanded="pickerOpen" @click="pickerOpen = !pickerOpen">从列表选择</button><button class="image-text-button" :disabled="busy" :aria-expanded="manualOpen" @click="manualOpen = !manualOpen">手动添加</button></div></header>
    <div v-if="manualOpen" class="image-manual-add"><input v-model="manualId" placeholder="生图模型 ID" aria-label="手动生图模型 ID" @keydown.enter.prevent="addManual" /><button class="settings-command" :disabled="busy || !manualId.trim()" @click="addManual">添加</button></div>
    <ModelDiscoveryList v-if="pickerOpen" :models="availableModels" :added-model-ids="addedIds" :saving="busy" purpose="image" @add="addModels" />
    <div v-for="model in models" :key="model.id" class="image-model-row">
      <div class="image-model-main">
        <input type="checkbox" :checked="model.enabled" :disabled="busy" :aria-label="'启用生图模型 ' + model.model" @change="update(model.id, { enabled: ($event.target as HTMLInputElement).checked })" />
        <select class="model-name" :value="model.model" :disabled="busy" aria-label="选择生图模型" @change="update(model.id, { model: ($event.target as HTMLSelectElement).value })"><option v-if="!availableModels.some(item => item.id === model.model)" :value="model.model">{{ model.model }}</option><option v-for="candidate in availableModels" :key="candidate.id" :value="candidate.id">{{ candidate.name || candidate.id }}</option></select>
        <button class="image-text-button" :class="{ 'is-default': settings.default_id === model.id }" :disabled="busy || !model.enabled" @click="setDefault(model.id)">{{ settings.default_id === model.id ? '默认' : '设为默认' }}</button><button class="image-text-button" :disabled="busy" @click="remove(model.id)">移除</button>
      </div>
      <div class="image-model-options">
        <label class="image-protocol">协议<select :value="model.protocol" :disabled="busy" @change="update(model.id, { protocol: ($event.target as HTMLSelectElement).value as ImageModel['protocol'] })"><option value="images">Images API</option><option value="responses">Responses API</option></select></label>
        <ImageOutputOptions compact :parameters="imageParameters(model.model, model.parameters)" :size="model.size" :quality="model.quality" :disabled="busy" @update:size="update(model.id, { size: $event })" @update:quality="update(model.id, { quality: $event })" />
      </div>
      <div class="image-stream-row"><label class="image-stream-checkbox"><input type="checkbox" :checked="model.streaming" :disabled="busy" @change="update(model.id, { streaming: ($event.target as HTMLInputElement).checked })" />实时中间图</label><small>仅在服务商支持流式生图时启用</small></div>
      <label v-if="model.protocol === 'responses'" class="request-model">调用工具的对话模型<select :value="model.request_model ?? ''" :disabled="busy" @change="update(model.id, { request_model: ($event.target as HTMLSelectElement).value })"><option value="" disabled>选择对话模型</option><option v-if="model.request_model && !requestModels.some(item => item.id === model.request_model)" :value="model.request_model">{{ model.request_model }}</option><option v-for="candidate in requestModels" :key="candidate.id" :value="candidate.id">{{ candidate.name || candidate.id }}</option></select></label>
    </div>
    <p v-if="!models.length && !pickerOpen" class="image-setting-hint">复用本服务商的 URL 和 Key，从已获取的模型中选择。</p>
    <footer v-if="dirty || models.length"><button class="settings-command" :disabled="busy || !dirty" @click="save">{{ busy ? '保存中…' : '保存生图配置' }}</button><span role="status">{{ notice || (dirty ? '有未保存的修改' : '') }}</span></footer>
    <p v-if="error" role="alert" class="image-model-error">{{ error }}</p>
  </section>
</template>

<style scoped>
.image-model-settings { border-top: 1px solid var(--settings-line); padding-top: 18px; display: grid; gap: 12px; min-width: 0; }
.image-settings-heading,.image-settings-actions,.image-model-main,.image-stream-row { display: flex; align-items: center; gap: 10px; min-width: 0; }.image-settings-heading { justify-content: space-between; }.image-settings-heading h3 { margin: 0; font-size: 14px; font-weight: 550; }
.image-model-row { display: grid; gap: 12px; padding: 10px 0 16px; border-bottom: 1px solid var(--settings-line); min-width: 0; }
.image-model-main .model-name { flex: 1; min-width: 0; max-width: 100%; }
.image-text-button { border: 0; background: none; color: var(--settings-muted); cursor: pointer; font-size: 11px; white-space: nowrap; padding: 3px; }.is-default { color: var(--settings-text); }
.image-model-options { display: flex; align-items: start; flex-wrap: wrap; gap: 10px 16px; }.image-protocol,.request-model,.image-stream-checkbox { display: flex; align-items: center; gap: 7px; color: var(--settings-muted); font-size: 11px; min-width: 0; }.request-model select { flex: 1; min-width: 0; }
.image-model-settings input:not([type=checkbox]),.image-model-settings select { background: var(--settings-field); color: var(--settings-text); border: 1px solid var(--settings-line); border-radius: 6px; padding: 6px 8px; font-size: 12px; }
.image-stream-row { flex-wrap: wrap; gap: 6px 12px; }.image-stream-row small,.image-setting-hint { color: var(--settings-muted); font-size: 11px; }.image-setting-hint { margin: 0; line-height: 1.6; }
.image-manual-add { display: flex; gap: 8px; }.image-manual-add input { flex: 1; min-width: 0; }
.image-model-settings footer { display: flex; gap: 12px; align-items: center; font-size: 11px; color: var(--settings-muted); }.image-model-error { color: #c8645d; font-size: 12px; line-height: 1.6; margin: 0; overflow-wrap: anywhere; }
input[type=checkbox] { flex-shrink: 0; width: 14px; height: 14px; margin: 0; accent-color: #007acc; }button:disabled { opacity: .5; cursor: default; }button:focus-visible,input:focus-visible,select:focus-visible { outline: 2px solid var(--settings-muted); outline-offset: 2px; }
</style>
