<script setup lang="ts">
import { reactive, watch } from 'vue'
import { modelFormFromSummary, type ModelForm, type ModelSummary, type ModelProviderSummary } from '../../api/plcBridge'
import type { ReasoningEffort } from '../../types/codex'
const props = defineProps<{ model: ModelSummary | null; provider: ModelProviderSummary; busy: boolean }>()
const emit = defineEmits<{ save: [form: ModelForm]; close: [] }>()
const levels: Array<[ReasoningEffort, string]> = [['none','不思考'],['minimal','轻量'],['low','低'],['medium','标准'],['high','高'],['xhigh','极高'],['max','Max']]
const form = reactive<ModelForm>({ id: '', name: '', providerId: props.provider.id, provider: props.provider.provider, baseUrl: props.provider.base_url, apiKey: '', model: '', contextWindow: 128000, maxTokens: 4096, reasoningLevels: levels.map(([level]) => level), enabled: true, isDefault: false })
let syncedForm = ''
watch(() => [props.model, props.busy] as const, ([model, busy], previous) => {
  if (model && (form.id !== model.id || !syncedForm || (previous?.[1] && !busy) || JSON.stringify(form) === syncedForm)) {
    Object.assign(form, modelFormFromSummary(model)); syncedForm = JSON.stringify(form)
  }
}, { immediate: true })
function save() { emit('save', { ...form, providerId: props.provider.id, provider: props.provider.provider, baseUrl: props.provider.base_url, contextWindow: Number(form.contextWindow), maxTokens: Number(form.maxTokens), reasoningLevels: [...form.reasoningLevels] }) }
</script>

<template>
  <form class="profile-editor" @submit.prevent="save">
    <div class="profile-heading"><strong>{{ model ? '编辑模型' : '添加模型' }}</strong><button type="button" class="settings-command" @click="emit('close')">收起</button></div>
    <fieldset :disabled="busy" class="profile-fields">
      <label>模型 ID<input v-model="form.model" required placeholder="填写服务商提供的模型 ID" /></label>
      <label>显示名称<input v-model="form.name" maxlength="80" placeholder="可选，默认使用模型 ID" /></label>
      <label>上下文长度<input v-model.number="form.contextWindow" type="number" min="1024" max="10000000" required /></label>
      <label>最大输出 Token<input v-model.number="form.maxTokens" type="number" min="1" :max="form.contextWindow" required /></label>
    </fieldset>
    <fieldset :disabled="busy" class="profile-levels"><legend>允许的思考等级</legend><label v-for="[value, title] in levels" :key="value"><input v-model="form.reasoningLevels" type="checkbox" :value="value" :disabled="form.reasoningLevels.length === 1 && form.reasoningLevels.includes(value)" />{{ title }}</label></fieldset>
    <label class="profile-default"><input v-model="form.isDefault" type="checkbox" :disabled="!provider.enabled" />设为默认模型</label>
    <div><button class="settings-command" :disabled="busy">{{ busy ? '保存中…' : '保存模型' }}</button></div>
  </form>
</template>

<style scoped>
.profile-editor { display: grid; gap: 16px; padding-top: 18px; border-top: 1px solid var(--settings-line); }.profile-heading { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.profile-fields { margin: 0; padding: 0; border: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; min-width: 0; }.profile-fields label { display: grid; gap: 7px; font-size: 12px; color: var(--settings-muted); }
.profile-fields input { width: 100%; min-width: 0; box-sizing: border-box; padding: 9px 10px; border: 1px solid var(--settings-line); border-radius: 6px; background: var(--settings-field); color: var(--settings-text); }
.profile-levels { border: 0; padding: 0; margin: 0; display: flex; gap: 12px; flex-wrap: wrap; }.profile-levels legend { margin-bottom: 10px; font-size: 12px; color: var(--settings-muted); }.profile-levels label,.profile-default { display: flex; align-items: center; gap: 5px; font-size: 12px; }
input { accent-color: #007acc; } input:focus-visible { outline: 2px solid #007acc; outline-offset: 1px; }
</style>
