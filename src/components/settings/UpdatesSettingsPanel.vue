<script setup lang="ts">
import { computed } from 'vue'
import { IconRefresh, IconDownload, IconExternalLink } from '@tabler/icons-vue'
import type { AppUpdateState } from '../../composables/useAppUpdates'

const props = defineProps<{ state: AppUpdateState; busy: boolean; tasksRunning: boolean }>()
const emit = defineEmits<{ check: []; install: []; 'auto-check': [value: boolean] }>()
const percent = computed(() => props.state.total ? Math.min(100, Math.round(props.state.downloaded / props.state.total * 100)) : null)
const status = computed(() => ({ idle: '随时获取最新改进', checking: '正在检查更新…', current: '已是最新版本', available: '新版本已就绪', saving: '正在保存会话与草稿…', downloading: '正在下载更新…', verifying: '正在校验更新文件…', installing: '正在安装，完成后会重新打开…', error: '稍后再试或重新检查' })[props.state.phase])
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
</script>

<template>
  <section class="updates-panel" aria-label="软件更新">
    <h2>软件更新</h2>
    <div class="updates-version"><div><strong>PLC Pilot</strong><p>版本 {{ state.version || '—' }} · {{ state.portable ? '便携版' : '安装版' }}</p></div><button class="settings-command" :disabled="busy || !state.enabled" @click="emit('check')"><IconRefresh :class="{ spinning: state.phase === 'checking' }" />检查更新</button></div>
    <p class="updates-status" role="status">{{ state.enabled ? status : '请在桌面程序中检查更新。' }}</p>
    <p v-if="state.lastChecked" class="settings-feedback">上次检查：{{ state.lastChecked }}</p>
    <label class="settings-field-row updates-auto"><span><strong>自动检查更新</strong><small>启动后及每 24 小时检查，有新版本时提醒你。</small></span><input type="checkbox" role="switch" :checked="state.autoCheck" :disabled="!state.enabled" @change="emit('auto-check', ($event.target as HTMLInputElement).checked)" /></label>
    <section v-if="state.available" class="updates-release" aria-label="新版本">
      <div class="updates-release-heading"><h3>{{ state.available.version }}</h3><small v-if="state.available.size">{{ size(state.available.size) }}</small></div>
      <p class="updates-notes">{{ state.available.notes || '包含功能改进和问题修复。' }}</p>
      <div v-if="state.phase === 'downloading'" class="updates-download" role="status"><progress :value="percent ?? undefined" max="100" aria-label="更新下载进度" /><small>{{ size(state.downloaded) }}<template v-if="state.total"> / {{ size(state.total) }} · {{ percent }}%</template></small></div>
      <button class="settings-command updates-install" :disabled="busy || tasksRunning" @click="emit('install')"><IconDownload />{{ busy ? status : '下载并安装更新' }}</button>
      <p class="settings-feedback">{{ tasksRunning ? '还有任务或排队消息，处理完毕后即可更新。' : '会先保存草稿与会话，再重启软件。项目、模型设置和聊天记录会保留。' }}</p>
    </section>
    <p v-if="state.error" class="settings-feedback error" role="alert">{{ state.error }}</p>
    <a class="updates-link" href="https://github.com/1812095643/PLCpilot/releases" target="_blank" rel="noopener noreferrer">查看全部版本与安装包<IconExternalLink /></a>
  </section>
</template>

<style scoped>
.updates-panel { max-width: 680px; }
.updates-version, .updates-release-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.updates-version strong { font-size: 16px; font-weight: 600; }
.updates-version p { margin: 6px 0 0; color: var(--settings-muted); font-size: 12px; }
.settings-command { display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
.settings-command svg, .updates-link svg { width: 15px; height: 15px; }
.updates-status { margin: 24px 0 4px; font-size: 13px; }
.updates-auto { margin-top: 26px; gap: 24px; cursor: pointer; }
.updates-auto strong { font-size: 13px; font-weight: 500; }
.updates-auto small { display: block; font-size: 12px; color: var(--settings-muted); margin-top: 6px; }
.updates-auto input { appearance: none; position: relative; flex: 0 0 auto; width: 32px; height: 18px; margin: 0; border-radius: 12px; background: var(--settings-line); cursor: pointer; transition: background .18s ease; }
.updates-auto input::after { content: ''; position: absolute; inset: 3px auto auto 3px; width: 12px; height: 12px; border-radius: 50%; background: var(--settings-bg); transition: transform .18s ease; }
.updates-auto input:checked { background: var(--settings-text); }
.updates-auto input:checked::after { transform: translateX(14px); }
.updates-auto input:focus-visible { outline: 2px solid var(--settings-muted); outline-offset: 3px; }
.updates-auto input:disabled { opacity: .5; cursor: default; }
.updates-release { padding: 14px 0 6px; border-bottom: 1px solid var(--settings-line); }
.updates-release-heading h3 { margin: 12px 0; }
.updates-release-heading small { color: var(--settings-muted); font-size: 12px; }
.updates-notes { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 260px; overflow: auto; line-height: 1.75; font-size: 13px; margin: 0 0 18px; }
.updates-install { min-height: 34px; }
.updates-download { display: grid; gap: 7px; margin: 18px 0; }
.updates-download progress { width: 100%; height: 6px; accent-color: var(--settings-text); }
.updates-download small { font-variant-numeric: tabular-nums; color: var(--settings-muted); }
.updates-link { display: inline-flex; align-items: center; gap: 5px; margin-top: 26px; color: var(--settings-muted); text-decoration: none; font-size: 12px; }
.updates-link:hover { color: var(--settings-text); }
.spinning { animation: update-spin 1.4s linear infinite; }
@keyframes update-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
</style>
