<script setup lang="ts">
import type { ProviderForm } from '../../composables/useModelProviders'
const form = defineModel<ProviderForm>({ required: true })
defineProps<{ busy: boolean; hasKey: boolean }>()
const emit = defineEmits<{ save: []; discover: [] }>()
</script>

<template>
  <form class="provider-connection" @submit.prevent="emit('save')">
    <fieldset :disabled="busy" class="provider-fields">
      <label>服务商名称<input v-model="form.name" required maxlength="80" placeholder="例如：公司网关、DeepSeek" /></label>
      <label>接口类型<select v-model="form.provider"><option value="chatcompletions">Chat Completions</option><option value="responses">Responses</option><option value="messages">Messages</option><option value="ollama">Ollama</option></select></label>
      <label class="wide">服务商 URL<input v-model="form.baseUrl" type="url" required placeholder="https://api.example.com/v1" /></label>
      <label class="wide">API Key<input v-model="form.apiKey" type="password" autocomplete="new-password" :placeholder="hasKey ? '已安全保存；同一地址留空保持原 Key' : '填写此服务商的 API Key'" /></label>
    </fieldset>
    <div class="provider-actions">
      <button class="settings-command" type="submit" :disabled="busy">{{ busy ? '正在处理…' : '保存服务商' }}</button>
      <button class="settings-command" type="button" :disabled="busy || !form.name.trim() || !form.baseUrl.trim()" @click="emit('discover')">保存并获取模型</button>
    </div>
  </form>
</template>

<style scoped>
.provider-connection { display: grid; gap: 14px; }.provider-fields { border: 0; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; min-width: 0; }
label { display: grid; min-width: 0; gap: 7px; color: var(--settings-muted); font-size: 12px; }.wide { grid-column: 1 / -1; }
input, select { min-width: 0; width: 100%; box-sizing: border-box; background: var(--settings-field); color: var(--settings-text); border: 1px solid var(--settings-line); border-radius: 6px; padding: 9px 10px; font-size: 13px; }
input:focus-visible, select:focus-visible { outline: 2px solid #007acc; outline-offset: 1px; }.provider-actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
