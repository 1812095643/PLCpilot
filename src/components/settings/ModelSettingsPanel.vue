<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import type { ModelForm, ModelSummary, ModelProviderSummary } from '../../api/plcBridge'
import { useModelProviders } from '../../composables/useModelProviders'
import ProviderConnectionForm from './ProviderConnectionForm.vue'
import ModelProfileEditor from './ModelProfileEditor.vue'
import ModelDiscoveryList from './ModelDiscoveryList.vue'
import IconTablerTrash from '../icons/IconTablerTrash.vue'
import IconTablerCopy from '../icons/IconTablerCopy.vue'

const props = defineProps<{ models: ModelSummary[]; activeModelId: string; selectedModelId: string; isSaving: boolean;
  currentContextTokens: number; remainingContextPercent: number | null; autoCompactionEnabled: boolean; discoveryRequest: number }>()
const emit = defineEmits<{ save: [form: ModelForm]; refresh: []; 'discovery-handled': []; duplicate: [id: string]; 'set-active': [id: string]; 'toggle-enabled': [id: string, enabled: boolean]; remove: [id: string] }>()
const manager = useModelProviders(() => emit('refresh'))
const { providers, form, discovery, busy, loading, error, notice } = manager
const editingModelId = shallowRef<string | null>(null)
const confirmingDelete = shallowRef(false)
const selectedProvider = computed(() => providers.value.find(provider => provider.id === form.value.id) ?? null)
const providerModels = computed(() => props.models.filter(model => model.provider_id === form.value.id))
const editingModel = computed(() => providerModels.value.find(model => model.id === editingModelId.value) ?? null)
const counts = computed(() => new Map(providers.value.map(provider => [provider.id, props.models.filter(model => model.provider_id === provider.id).length])))
const blocked = computed(() => busy.value || props.isSaving)
function select(provider?: ModelProviderSummary) { manager.select(provider); editingModelId.value = null; confirmingDelete.value = false }
watch(() => props.selectedModelId, id => { if (providerModels.value.some(model => model.id === id) && editingModelId.value !== null) editingModelId.value = id })
watch(() => props.models, () => { void manager.reload() })
function discoverRequested() { if (props.discoveryRequest > 0 && form.value.id) { emit('discovery-handled'); void manager.discover() } }
watch(() => props.discoveryRequest, discoverRequested)
onMounted(async () => { await manager.reload(props.models.find(model => model.id === props.selectedModelId)?.provider_id); discoverRequested() })
</script>

<template>
  <section class="provider-settings">
    <header class="provider-heading"><h2>服务商与模型</h2><button class="settings-command" :disabled="blocked || loading" @click="select()">添加服务商</button></header>
    <p class="provider-hint">每个 URL 独立管理连接和模型，多个服务商可同时启用。</p>
    <p v-if="loading" class="provider-hint" role="status">正在读取服务商…</p>
    <div v-else class="provider-layout">
      <nav class="provider-list" aria-label="服务商列表">
        <div v-for="provider in providers" :key="provider.id" class="provider-item" :class="{ selected: provider.id === form.id }">
          <button class="provider-select" :disabled="blocked" :aria-pressed="provider.id === form.id" :title="provider.base_url" @click="select(provider)">
            <strong>{{ provider.name }}</strong><small>{{ provider.base_url }}</small><small>{{ counts.get(provider.id) || 0 }} 个模型 · {{ provider.enabled ? '已启用' : '已停用' }}</small>
          </button>
          <input class="provider-toggle" type="checkbox" :checked="provider.enabled" :disabled="blocked" :aria-label="`启用服务商 ${provider.name}`" @change="manager.toggle(provider, ($event.target as HTMLInputElement).checked)" />
        </div>
        <p v-if="!providers.length" class="provider-hint">添加服务商，填写 URL 和 Key 即可开始。</p>
      </nav>
      <div class="provider-detail">
        <header class="provider-detail-heading"><h3>{{ selectedProvider ? selectedProvider.name : '添加服务商' }}</h3><button v-if="selectedProvider" class="provider-icon" :disabled="blocked" aria-label="删除服务商" title="删除服务商" @click="confirmingDelete = !confirmingDelete"><IconTablerTrash /></button></header>
        <div v-if="confirmingDelete" class="provider-confirm" role="alert"><p>删除“{{ selectedProvider?.name }}”及其 {{ providerModels.length }} 个模型配置？聊天记录会保留。</p><button class="settings-command" :disabled="blocked" @click="manager.remove(); confirmingDelete = false">确认删除</button><button class="settings-command" @click="confirmingDelete = false">取消</button></div>
        <ProviderConnectionForm v-model="form" :busy="blocked" :has-key="selectedProvider?.api_key_configured ?? false" @save="manager.save" @discover="manager.discover" />
        <p v-if="error" class="provider-error" role="alert">{{ error }}</p><p v-if="notice" class="provider-hint" role="status">{{ notice }}</p>
        <ModelDiscoveryList v-if="discovery" :discovery="discovery" :added-model-ids="providerModels.map(model => model.model)" :saving="blocked" @add="manager.add" />
        <section v-if="selectedProvider" class="provider-models" aria-label="此服务商的模型">
          <header class="provider-detail-heading"><h3>已添加模型 <small>{{ providerModels.length }}</small></h3><button class="settings-command" :disabled="blocked" @click="editingModelId = ''">添加模型</button></header>
          <p v-if="!providerModels.length" class="provider-hint">获取模型后勾选添加，也可以手动填写模型 ID。</p>
          <div v-for="model in providerModels" :key="model.id" class="provider-model">
            <input type="checkbox" :checked="model.selected ?? model.enabled" :disabled="blocked" :aria-label="`启用模型 ${model.model}`" @change="emit('toggle-enabled', model.id, ($event.target as HTMLInputElement).checked)" />
            <button class="model-edit" :disabled="blocked" @click="editingModelId = model.id"><strong>{{ model.name || model.model }}</strong><small>{{ model.model }} · {{ Math.round(model.context_window / 1000) }}K 上下文</small></button>
            <button v-if="model.enabled && model.id !== activeModelId" class="provider-text-button" :disabled="blocked" @click="emit('set-active', model.id)">设为默认</button><small v-else-if="model.is_default" class="provider-hint">默认</small>
            <button class="provider-icon" :disabled="blocked" :aria-label="`删除模型 ${model.model}`" @click="emit('remove', model.id)"><IconTablerTrash /></button>
            <button class="provider-icon" :disabled="blocked" :aria-label="`复制模型 ${model.model}`" @click="emit('duplicate', model.id)"><IconTablerCopy /></button>
          </div>
          <ModelProfileEditor v-if="editingModelId !== null" :key="`${form.id}:${editingModelId}`" :model="editingModel" :provider="selectedProvider" :busy="blocked" @save="emit('save', $event)" @close="editingModelId = null" />
        </section>
      </div>
    </div>
    <p class="provider-context">当前会话 {{ currentContextTokens.toLocaleString() }} tokens<span v-if="remainingContextPercent !== null"> · 剩余 {{ Math.round(remainingContextPercent) }}%</span> · 自动压缩{{ autoCompactionEnabled ? '已开启' : '已关闭' }}</p>
  </section>
</template>

<style scoped>
.provider-settings { display: grid; gap: 16px; color: var(--settings-text); min-width: 0; }.provider-heading,.provider-detail-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
h2,h3,p { margin: 0; }h2 { font-size: 21px; font-weight: 600; }h3 { font-size: 14px; font-weight: 550; }h3 small { color: var(--settings-muted); margin-left: 5px; }
.provider-hint,.provider-context { font-size: 12px; color: var(--settings-muted); line-height: 1.6; }.provider-context { border-top: 1px solid var(--settings-line); padding-top: 16px; }
.provider-layout { display: grid; grid-template-columns: 205px minmax(0, 1fr); gap: 24px; align-items: start; }.provider-list { display: grid; gap: 4px; border-right: 1px solid var(--settings-line); padding-right: 14px; max-height: 600px; overflow-y: auto; }
.provider-item { display: flex; align-items: center; border-radius: 6px; gap: 8px; padding-right: 8px; }.provider-item:hover,.provider-item.selected { background: var(--settings-field); }
.provider-select { display: grid; gap: 5px; min-width: 0; flex: 1; text-align: left; background: transparent; border: 0; color: inherit; padding: 11px 9px; cursor: pointer; }.provider-select strong,.provider-select small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.provider-select strong { font-size: 12px; font-weight: 550; }.provider-select small { font-size: 10px; color: var(--settings-muted); }
.provider-detail { display: grid; min-width: 0; gap: 18px; }.provider-models { display: grid; gap: 10px; border-top: 1px solid var(--settings-line); padding-top: 18px; }.provider-model { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 5px 0; }
.model-edit { display: grid; flex: 1; min-width: 0; gap: 4px; padding: 3px 0; border: 0; text-align: left; color: inherit; background: transparent; cursor: pointer; }.model-edit strong,.model-edit small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.model-edit strong { font-size: 12px; font-weight: 500; }.model-edit small { font-size: 10px; color: var(--settings-muted); }
.provider-icon { border: 0; background: transparent; color: var(--settings-muted); width: 28px; height: 28px; padding: 6px; border-radius: 5px; cursor: pointer; flex-shrink: 0; }.provider-icon:hover { background: var(--settings-field); }.provider-icon :deep(svg) { width: 16px; height: 16px; }.provider-text-button { color: var(--settings-muted); background: transparent; border: 0; font-size: 11px; cursor: pointer; padding: 4px; }
.provider-error { color: #d65353; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }.provider-confirm { border: 1px solid var(--settings-line); border-radius: 6px; padding: 12px; font-size: 12px; }.provider-confirm p { margin-bottom: 10px; }.provider-confirm button + button { margin-left: 8px; }
input[type=checkbox] { accent-color: #007acc; width: 14px; height: 14px; margin: 0; flex-shrink: 0; }button:disabled { opacity: .5; cursor: default; }button:focus-visible,input:focus-visible { outline: 2px solid #007acc; outline-offset: 2px; }
@media(max-width: 1080px) { .provider-layout { grid-template-columns: 170px minmax(0, 1fr); gap: 16px; } }@media(max-width: 800px) { .provider-layout { grid-template-columns: 1fr; }.provider-list { border-right: 0; border-bottom: 1px solid var(--settings-line); padding: 0 0 12px; max-height: 180px; } }
</style>
