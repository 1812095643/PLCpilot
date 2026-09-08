<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import type { ModelDiscoveryResult, ModelForm, ModelSummary, ProviderKind } from '../../api/plcBridge'
import type { ReasoningEffort } from '../../types/codex'
import IconTablerCopy from '../icons/IconTablerCopy.vue'
import IconTablerRefresh from '../icons/IconTablerRefresh.vue'
import IconTablerTrash from '../icons/IconTablerTrash.vue'
import ModelDiscoveryList from './ModelDiscoveryList.vue'

const props = defineProps<{
  models: ModelSummary[]
  activeModelId: string
  selectedModelId: string
  discovery: ModelDiscoveryResult | null
  discoveryError: string
  isDiscovering: boolean
  isSaving: boolean
  currentContextTokens: number
  remainingContextPercent: number | null
  autoCompactionEnabled: boolean
}>()

const emit = defineEmits<{
  save: [form: ModelForm]
  discover: [form: ModelForm]
  import: [form: ModelForm, ids: string[]]
  'set-active': [id: string]
  'toggle-enabled': [id: string, enabled: boolean]
  duplicate: [id: string]
  remove: [id: string]
}>()

const reasoningOptions: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'none', label: '不思考' },
  { value: 'minimal', label: '轻量' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '标准' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
  { value: 'max', label: 'Max（最高）' },
]

function emptyForm(isDefault = false): ModelForm {
  return {
    id: '',
    name: '',
    provider: 'responses',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5',
    apiKey: '',
    contextWindow: 128000,
    maxTokens: 4096,
    reasoningLevels: reasoningOptions.map((option) => option.value),
    enabled: true,
    isDefault,
  }
}

const editingId = shallowRef('')
const form = reactive<ModelForm>(emptyForm())
const intentionalNew = shallowRef(false)
let syncedForm = ''
const addedModelIds = computed(() => props.models.filter((model) => model.provider === form.provider && model.base_url.replace(/\/+$/u, '') === form.baseUrl.trim().replace(/\/+$/u, '')).map((model) => model.model))

const selectedModel = computed(() => props.models.find((model) => model.id === editingId.value) ?? null)
const isCreating = computed(() => editingId.value.length === 0)
type ProviderGroup = { key: string; url: string; provider: ProviderKind; models: ModelSummary[] }
const providerGroups = computed<ProviderGroup[]>(() => {
  const groups = new Map<string, ProviderGroup>()
  for (const model of props.models) {
    const url = model.base_url.trim().replace(/\/+$/u, '')
    const group = groups.get(url) ?? { key: url, url, provider: model.provider, models: [] }
    group.models.push(model)
    groups.set(url, group)
  }
  return [...groups.values()]
})
const selectedProvider = computed(() => providerGroups.value.find((group) => group.key === (selectedModel.value?.base_url.trim().replace(/\/+$/u, '') || form.baseUrl.trim().replace(/\/+$/u, ''))) ?? providerGroups.value[0] ?? null)
const providerModels = computed(() => selectedProvider.value?.models ?? [])
function providerTitle(group: ProviderGroup): string {
  try { return new URL(group.url).hostname || group.url }
  catch { return group.url || '未命名服务商' }
}
function providerTypeLabel(provider: ProviderKind): string {
  return providerLabel(provider)
}

function copySummaryToForm(model: ModelSummary): void {
  intentionalNew.value = false
  editingId.value = model.id
  Object.assign(form, {
    id: model.id,
    name: model.name,
    provider: model.provider,
    baseUrl: model.base_url,
    model: model.model,
    apiKey: '',
    contextWindow: model.context_window,
    maxTokens: model.max_tokens,
    reasoningLevels: model.reasoning_levels.filter((level): level is ReasoningEffort => reasoningOptions.some((option) => option.value === level)),
    enabled: model.enabled,
    isDefault: model.is_default,
  })
  if (form.reasoningLevels.length === 0) {
    form.reasoningLevels = ['none']
  }
  syncedForm = JSON.stringify(form)
}

function selectModel(id: string): void {
  const model = props.models.find((item) => item.id === id)
  if (model) copySummaryToForm(model)
}

function startNewModel(): void {
  intentionalNew.value = true
  editingId.value = ''
  Object.assign(form, emptyForm(props.models.length === 0))
}

function startNewModelForProvider(group: ProviderGroup): void {
  intentionalNew.value = true
  editingId.value = ''
  Object.assign(form, { ...emptyForm(false), provider: group.provider, baseUrl: group.url, model: '' })
}

function selectProvider(key: string): void {
  const model = providerGroups.value.find((group) => group.key === key)?.models[0]
  if (model) selectModel(model.id)
}

function toggleReasoning(level: ReasoningEffort): void {
  const next = form.reasoningLevels.includes(level)
    ? form.reasoningLevels.filter((item) => item !== level)
    : [...form.reasoningLevels, level]
  if (next.length === 0) return
  form.reasoningLevels = reasoningOptions
    .map((option) => option.value)
    .filter((option) => next.includes(option))
}

function onSave(): void {
  emit('save', {
    ...form,
    contextWindow: Math.trunc(Number(form.contextWindow)),
    maxTokens: Math.trunc(Number(form.maxTokens)),
    reasoningLevels: [...form.reasoningLevels],
  })
}

function onDiscover(): void {
  emit('discover', {
    ...form,
    contextWindow: Math.trunc(Number(form.contextWindow)),
    maxTokens: Math.trunc(Number(form.maxTokens)),
    reasoningLevels: [...form.reasoningLevels],
  })
}

function providerLabel(provider: ProviderKind): string {
  if (provider === 'chatcompletions') return 'Chat Completions'
  if (provider === 'responses') return 'Responses'
  if (provider === 'messages') return 'Messages'
  return 'Ollama'
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

// 异步快照更新时 model-default 的 ID 往往不变。旧监听只比较 ID，导致本机
// 已保存的 URL 没有填回表单。监听真实模型集合，并仅在未编辑或保存完成时同步。
watch(() => [props.models, props.selectedModelId, props.activeModelId, props.isSaving] as const, (next, previous) => {
  const selectionChanged = previous && next[1] !== previous[1]
  const saved = previous?.[3] && !next[3]
  if (intentionalNew.value && !selectionChanged) return
  const target = props.models.find((model) => model.id === (selectionChanged ? props.selectedModelId : editingId.value))
    ?? props.models.find((model) => model.id === props.selectedModelId)
    ?? props.models.find((model) => model.id === props.activeModelId)
    ?? props.models[0]
  if (target && (!editingId.value || selectionChanged || saved || JSON.stringify(form) === syncedForm)) copySummaryToForm(target)
}, { immediate: true })
</script>

<template>
  <section class="model-settings-panel">
    <div class="model-settings-heading">
      <div>
        <h2>模型</h2>
      </div>
      <button type="button" class="model-settings-new" @click="startNewModel">新增模型</button>
    </div>

    <p class="model-settings-runtime" aria-label="当前会话上下文">当前会话 {{ props.currentContextTokens.toLocaleString() }} / {{ formatContextWindow(props.models.find((model) => model.id === props.selectedModelId)?.context_window || 0) }} tokens<span v-if="props.remainingContextPercent !== null"> · 剩余 {{ Math.round(props.remainingContextPercent) }}%</span> · 自动压缩{{ props.autoCompactionEnabled ? '已开启' : '已关闭' }}</p>

    <div class="model-settings-layout">
      <div class="model-settings-list" role="listbox" aria-label="模型配置列表">
        <button
          v-for="group in providerGroups"
          :key="group.key"
          type="button"
          class="model-settings-row"
          :class="{ 'is-selected': group.key === selectedProvider?.key }"
          :title="group.url"
          role="option"
          :aria-selected="group.key === selectedProvider?.key"
          @click="selectProvider(group.key)"
        >
          <span class="model-settings-status" :data-state="group.models.some((model) => model.enabled) ? group.models[0]?.connection_status : 'disabled'" />
          <span class="model-settings-row-copy">
            <strong>{{ providerTitle(group) }}</strong>
            <small>{{ providerTypeLabel(group.provider) }} · {{ group.models.length }} 个模型 · {{ group.models.filter((model) => model.enabled).length }} 个已启用</small>
          </span>
          <span v-if="group.models.some((model) => model.id === props.selectedModelId)" class="model-settings-current">会话</span>
        </button>
        <p v-if="props.models.length === 0" class="model-settings-empty">还没有模型配置，请新增一个。</p>
      </div>

      <div class="model-settings-editor">
        <div class="model-settings-editor-heading">
          <div>
            <p class="model-settings-eyebrow">{{ isCreating ? '新增模型' : '编辑模型' }}</p>
          <h4>{{ selectedProvider ? providerTitle(selectedProvider) : '新服务商' }}</h4>
          </div>
          <span v-if="selectedModel" class="model-settings-editor-state" :data-enabled="selectedModel.enabled">
            {{ selectedModel.enabled ? '已启用' : '已停用' }}
          </span>
        </div>

        <div v-if="selectedProvider" class="provider-model-list">
          <div class="provider-model-list-heading"><span>此服务商的模型</span><button type="button" @click="startNewModelForProvider(selectedProvider)">添加模型</button></div>
          <button v-for="model in providerModels" :key="`provider-model:${model.id}`" type="button" class="provider-model-row" :class="{ selected: model.id === editingId }" @click="selectModel(model.id)">
            <span class="model-settings-status" :data-state="model.enabled ? model.connection_status : 'disabled'" />
            <span class="provider-model-name"><strong>{{ model.name || model.model }}</strong><small>{{ model.model }} · {{ formatContextWindow(model.context_window) }} · {{ model.enabled ? '对话中可用' : '已停用' }}</small></span>
            <input type="checkbox" :checked="model.enabled" :disabled="props.isSaving || (model.enabled && providerModels.filter((item) => item.enabled).length === 1)" aria-label="在对话选择器中显示" @click.stop @change="emit('toggle-enabled', model.id, ($event.target as HTMLInputElement).checked)" />
          </button>
        </div>
        <div class="model-settings-fields">
          <label>模型显示名称<input v-model="form.name" type="text" maxlength="80" placeholder="例如：生产网关 GPT-5" /></label>
          <label>接口类型
            <select v-model="form.provider">
              <option value="responses">Responses</option>
              <option value="messages">Messages</option>
              <option value="chatcompletions">Chat Completions</option>
              <option value="ollama">Ollama</option>
            </select>
          </label>
          <label class="model-settings-wide">服务商接口地址<input v-model="form.baseUrl" type="url" placeholder="https://api.example.com/v1" /></label>
          <div class="model-settings-model-row">
            <label>模型 ID<input v-model="form.model" type="text" list="plc-discovered-models" placeholder="gpt-5" /></label>
            <button type="button" class="model-settings-discover" :disabled="props.isDiscovering || props.isSaving" @click="onDiscover">
              <IconTablerRefresh />
              {{ props.isDiscovering ? '获取中' : '获取模型' }}
            </button>
          </div>
          <label>上下文长度<input v-model.number="form.contextWindow" type="number" min="1024" max="10000000" step="1024" /></label>
          <label>最大输出 Token<input v-model.number="form.maxTokens" type="number" min="1" :max="form.contextWindow" step="256" /></label>
          <label class="model-settings-wide">API Key
            <small>{{ selectedModel?.api_key_configured ? '相同接口留空保持原 Key；修改接口时请重新填写。' : '只写入本机 auth.json，不进入项目配置。' }}</small>
            <input v-model="form.apiKey" type="password" autocomplete="new-password" :placeholder="selectedModel?.api_key_configured ? 'Key 已安全保存，留空继续使用' : '输入 API Key'" />
          </label>
        </div>

        <fieldset class="model-settings-reasoning">
          <legend>允许的思考等级</legend>
          <label v-for="option in reasoningOptions" :key="option.value" class="model-settings-check">
            <input type="checkbox" :checked="form.reasoningLevels.includes(option.value)" @change="toggleReasoning(option.value)" />
            <span>{{ option.label }}</span>
          </label>
        </fieldset>

        <div class="model-settings-flags">
          <label class="model-settings-switch"><input v-model="form.isDefault" type="checkbox" /><span>保存为当前默认模型</span></label>
        </div>

        <div v-if="props.discoveryError" class="model-settings-error" role="alert">{{ props.discoveryError }}</div>
        <ModelDiscoveryList v-else-if="props.discovery" :discovery="props.discovery" :added-model-ids="addedModelIds" :saving="props.isSaving" @add="emit('import', { ...form, reasoningLevels: [...form.reasoningLevels] }, $event)" />
        <p v-if="selectedModel?.last_error" class="model-settings-last-error">最近一次检查未完成：{{ selectedModel.last_error }}</p>

        <div class="model-settings-actions">
          <button type="button" class="model-settings-save" :disabled="props.isSaving || props.isDiscovering" @click="onSave">{{ props.isSaving ? '保存中…' : '保存模型' }}</button>
          <button v-if="selectedModel && selectedModel.id !== props.activeModelId" type="button" class="model-settings-quiet" @click="emit('set-active', selectedModel.id)">设为当前</button>
          <button v-if="selectedModel" type="button" class="model-settings-icon-button" title="复制模型" aria-label="复制模型" @click="emit('duplicate', selectedModel.id)"><IconTablerCopy /></button>
          <button v-if="selectedModel && props.models.length > 1" type="button" class="model-settings-icon-button model-settings-delete" title="删除模型" aria-label="删除模型" @click="emit('remove', selectedModel.id)"><IconTablerTrash /></button>
        </div>
      </div>
    </div>

    <datalist id="plc-discovered-models">
      <option v-for="model in props.discovery?.models || []" :key="model.id" :value="model.id">{{ model.name }}</option>
    </datalist>
  </section>
</template>

<style scoped>
.model-settings-panel { display: flex; min-width: 0; flex-direction: column; gap: 20px; color: var(--settings-text, #333); }
.model-settings-heading, .model-settings-editor-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.model-settings-heading h2 { margin: 0; font-size: 22px; font-weight: 600; }
.model-settings-editor-heading h4 { margin: 0; font-size: 15px; font-weight: 600; }
.model-settings-eyebrow { display: none; }
.model-settings-runtime { margin: -8px 0 4px; padding-bottom: 20px; border-bottom: 1px solid var(--settings-line); color: var(--settings-muted); font-size: 12px; line-height: 1.6; }
.model-settings-new, .model-settings-save, .model-settings-quiet, .model-settings-discover, .model-settings-icon-button { display: inline-flex; min-height: 32px; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--settings-line); border-radius: 5px; background: var(--settings-field); color: var(--settings-text); font-size: 12px; font-weight: 500; line-height: 1.2; padding: 6px 12px; cursor: pointer; transition: background-color 150ms ease; }
.model-settings-new:hover, .model-settings-quiet:hover, .model-settings-discover:hover, .model-settings-icon-button:hover { background: var(--settings-line); }
.model-settings-save { border-color: #007acc; background: #007acc; color: #fff; }
.model-settings-save:hover { background: #0068ad; }
.model-settings-layout { display: grid; min-width: 0; grid-template-columns: 230px minmax(0, 1fr); gap: 30px; }
.model-settings-list { display: flex; min-width: 0; max-height: 540px; flex-direction: column; gap: 4px; overflow-y: auto; padding-right: 14px; border-right: 1px solid var(--settings-line); }
.model-settings-row { display: flex; min-width: 0; align-items: center; gap: 8px; border: 1px solid transparent; border-radius: 5px; background: transparent; padding: 10px; text-align: left; cursor: pointer; }
.model-settings-row:hover, .model-settings-row.is-selected { background: var(--settings-field); }
.model-settings-row.is-selected { border-color: var(--settings-line); }
.model-settings-status { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: #919191; }
.model-settings-status[data-state='connected'] { background: #48805d; }
.model-settings-status[data-state='error'] { background: #c42b1c; }
.model-settings-row-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 5px; }
.model-settings-row-copy strong { overflow: hidden; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.model-settings-row-copy small { overflow: hidden; color: var(--settings-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.model-settings-current, .model-settings-editor-state { flex: 0 0 auto; color: var(--settings-muted); font-size: 10px; }
.model-settings-empty { margin: 12px 6px; color: var(--settings-muted); font-size: 12px; line-height: 1.5; }
.provider-model-list { display:flex; flex-direction:column; gap:4px; border-top:1px solid var(--settings-line); border-bottom:1px solid var(--settings-line); padding:13px 0; }
.provider-model-list-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; color:var(--settings-muted); font-size:11px; padding:0 2px 5px; }
.provider-model-list-heading button { border:0; background:transparent; color:#007acc; font-size:11px; cursor:pointer; }.provider-model-list-heading button:hover { text-decoration:underline; }
.provider-model-row { display:flex; min-width:0; align-items:center; gap:9px; border:1px solid transparent; border-radius:6px; background:transparent; color:var(--settings-text); padding:7px 8px; text-align:left; cursor:pointer; }
.provider-model-row:hover,.provider-model-row.selected { border-color:var(--settings-line); background:var(--settings-field); }.provider-model-row input { width:15px; height:15px; margin-left:auto; accent-color:#007acc; }
.provider-model-name { display:flex; min-width:0; flex:1; flex-direction:column; gap:3px; }.provider-model-name strong { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:550; }.provider-model-name small { color:var(--settings-muted); font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.model-settings-editor { display: flex; min-width: 0; flex-direction: column; gap: 22px; }
.model-settings-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 16px; }
.model-settings-fields label { display: grid; min-width: 0; gap: 7px; font-size: 12px; font-weight: 500; }
.model-settings-fields label small { color: var(--settings-muted); font-size: 11px; font-weight: 400; line-height: 1.5; }
.model-settings-fields input, .model-settings-fields select { width: 100%; min-width: 0; min-height: 36px; box-sizing: border-box; border: 1px solid var(--settings-line); border-radius: 5px; background: var(--settings-field); color: var(--settings-text); font-size: 13px; padding: 8px 10px; }
.model-settings-fields input:focus, .model-settings-fields select:focus { outline: 2px solid #007acc; outline-offset: -1px; }
.model-settings-wide { grid-column: 1 / -1; }
.model-settings-model-row { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 8px; }
.model-settings-discover { min-height: 36px; white-space: nowrap; }
.model-settings-discover :deep(svg), .model-settings-icon-button :deep(svg) { width: 15px; height: 15px; }
.model-settings-reasoning { display: flex; flex-wrap: wrap; gap: 12px 16px; margin: 0; border: 0; border-top: 1px solid var(--settings-line); padding: 14px 0 0; }
.model-settings-reasoning legend { width: 100%; margin-bottom: 8px; font-size: 12px; font-weight: 500; }
.model-settings-check, .model-settings-switch { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.model-settings-check input, .model-settings-switch input { width: 15px; height: 15px; accent-color: #007acc; }
.model-settings-flags { display: flex; flex-wrap: wrap; gap: 16px; }
.model-settings-error, .model-settings-last-error { margin: 0; color: #c42b1c; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.model-settings-discovery { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--settings-line); padding-top: 16px; }
.model-settings-discovery-meta { display: flex; min-width: 0; flex-direction: column; gap: 4px; color: var(--settings-muted); font-size: 12px; }
.model-settings-discovery-meta code { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.model-settings-discovery-list { display: grid; max-height: 180px; gap: 3px; overflow-y: auto; }
.model-settings-discovery-list button { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 10px; border: 0; border-radius: 4px; background: var(--settings-field); color: var(--settings-text); font-size: 12px; padding: 8px 10px; text-align: left; cursor: pointer; }
.model-settings-discovery-list button:hover { background: var(--settings-line); }
.model-settings-discovery-list span, .model-settings-discovery-list code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-settings-discovery-list code, .model-settings-discovery p { color: var(--settings-muted); font-size: 11px; }
.model-settings-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-top: 6px; }
.model-settings-icon-button { width: 32px; height: 32px; padding: 0; }
.model-settings-delete:hover { color: #c42b1c; }
@media (max-width: 1000px) { .model-settings-layout { grid-template-columns: 180px minmax(0, 1fr); gap: 20px; }.model-settings-fields { grid-template-columns: 1fr; } }
@media (max-width: 760px) { .model-settings-layout { grid-template-columns: minmax(0, 1fr); }.model-settings-list { max-height: 180px; border-right: 0; border-bottom: 1px solid var(--settings-line); padding: 0 0 10px; }.model-settings-wide { grid-column: auto; } }
</style>
