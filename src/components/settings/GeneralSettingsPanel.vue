<script setup lang="ts">
import { onMounted, shallowRef } from 'vue'
import { getStartupEnabled, setStartupEnabled } from '../../api/settingsBridge'

const emit = defineEmits<{ notice: [message: string] }>()
const enabled = shallowRef(false)
const loading = shallowRef(true)
const saving = shallowRef(false)
const error = shallowRef('')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try { enabled.value = await getStartupEnabled() }
  catch (cause) { error.value = `开机自启状态未能读取，请重试。${String(cause)}` }
  finally { loading.value = false }
}

async function update(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const requested = input.checked
  input.checked = enabled.value
  saving.value = true
  error.value = ''
  try {
    enabled.value = await setStartupEnabled(requested)
    emit('notice', enabled.value ? '已开启开机自启。' : '已关闭开机自启。')
  } catch (cause) { error.value = `开机自启设置未能保存，请重试。${String(cause)}` }
  finally { saving.value = false }
}

onMounted(load)
</script>

<template>
  <section class="general-settings" aria-label="通用设置">
    <h2>通用</h2>
    <label class="settings-field-row startup-option">
      <span><strong>开机自启</strong><small>登录 Windows 后自动打开 PLC Pilot。</small></span>
      <input class="startup-switch" type="checkbox" role="switch" aria-label="开机自启"
        :checked="enabled" :disabled="loading || saving || Boolean(error)" :aria-busy="loading || saving" @change="update" />
    </label>
    <p v-if="loading || saving" class="settings-feedback" role="status">{{ saving ? '正在保存…' : '正在读取启动设置…' }}</p>
    <div v-if="error" class="startup-error"><p class="settings-feedback error" role="alert">{{ error }}</p><button class="settings-command" type="button" @click="load">重新读取</button></div>
  </section>
</template>

<style scoped>
.general-settings { max-width: 680px; }
.startup-option { gap: 24px; cursor: pointer; }
.startup-option strong { font-size: 13px; font-weight: 500; }
.startup-option small { display: block; margin-top: 6px; color: var(--settings-muted); font-size: 12px; line-height: 1.6; }
.startup-option .startup-switch { appearance: none; position: relative; flex: 0 0 auto; width: 34px; height: 20px; margin: 0; border: 0; border-radius: 12px; background: var(--settings-line); cursor: pointer; transition: background 180ms ease; }
.startup-option .startup-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--settings-bg); transition: transform 180ms ease; }
.startup-option .startup-switch:checked { background: var(--settings-text); }
.startup-option .startup-switch:checked::after { transform: translateX(14px); }
.startup-option .startup-switch:focus-visible { outline: 2px solid var(--settings-muted); outline-offset: 3px; }
.startup-option .startup-switch:disabled { opacity: .5; cursor: default; }
.startup-error { margin-top: 12px; }
@media (prefers-reduced-motion: reduce) { .startup-option .startup-switch, .startup-option .startup-switch::after { transition: none; } }
</style>
