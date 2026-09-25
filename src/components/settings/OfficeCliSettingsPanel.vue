<script setup lang="ts">
import { onMounted, shallowRef } from 'vue'
import { getOfficeCliStatus, installOfficeCli, setOfficeEngineMode, uninstallOfficeCli, type OfficeCliStatus } from '../../api/settingsBridge'
const emit = defineEmits<{ notice: [message: string] }>()
const status = shallowRef<OfficeCliStatus | null>(null), busy = shallowRef(false), error = shallowRef('')
async function load() { try { status.value = await getOfficeCliStatus() } catch (cause) { error.value = String(cause) } }
async function run(action: () => Promise<OfficeCliStatus>, message: string) { busy.value = true; error.value = ''; try { status.value = await action(); emit('notice', message) } catch (cause) { error.value = String(cause) } finally { busy.value = false } }
function setMode(event: Event) { const mode = (event.target as HTMLSelectElement).value as OfficeCliStatus['mode']; void run(() => setOfficeEngineMode(mode), '文件引擎模式已保存。') }
function install() { void run(installOfficeCli, 'OfficeCLI 已安装，可以在自动或 OfficeCLI 模式使用。') }
function uninstall() { void run(uninstallOfficeCli, 'OfficeCLI 已移除，已切回 PLC Pilot 原生引擎。') }
onMounted(load)
</script>
<template>
  <section class="officecli-settings" aria-label="文档引擎设置"><h2>文档处理引擎</h2><p class="settings-hint">PLC Pilot 原生 Rust 引擎默认处理文件；OfficeCLI 是可选的高保真兼容引擎，不包含 Electron。</p><div v-if="status" class="officecli-mode"><label for="document-engine">默认引擎</label><select id="document-engine" :value="status.mode" :disabled="busy" @change="setMode"><option value="native">PLC Pilot 原生</option><option value="auto">自动选择（推荐）</option><option value="officecli">OfficeCLI</option></select></div><div class="officecli-card"><div><strong>OfficeCLI {{ status?.installed ? `v${status.version}` : '未安装' }}</strong><small v-if="status?.installed">{{ status.size ? `${(status.size / 1024 / 1024).toFixed(1)} MiB` : '' }} · {{ status.path }}</small><small v-else>按需下载，固定版本校验后安装</small></div><div class="officecli-actions"><button v-if="!status?.installed" class="settings-command" :disabled="busy" @click="install">{{ busy ? '下载校验中…' : '一键安装' }}</button><button v-else class="settings-command" :disabled="busy" @click="uninstall">卸载</button></div></div><p v-if="error" class="settings-feedback error" role="alert">{{ error }}</p></section>
</template>
<style scoped>
.officecli-settings { max-width: 700px; }.officecli-settings h2 { margin-bottom: 8px; }.settings-hint { color: var(--settings-muted); font-size: 12px; line-height: 1.75; margin-bottom: 20px; }.officecli-mode { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--settings-line); padding: 12px 0; font-size: 12px; }.officecli-mode select { background: var(--settings-field); color: var(--settings-text); border: 1px solid var(--settings-line); border-radius: 5px; padding: 7px 9px; }.officecli-card { display: flex; justify-content: space-between; gap: 15px; align-items: center; padding: 15px 0; border-bottom: 1px solid var(--settings-line); }.officecli-card strong,.officecli-card small { display: block; }.officecli-card strong { font-size: 13px; font-weight: 500; }.officecli-card small { color: var(--settings-muted); font-size: 11px; margin-top: 6px; max-width: 500px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.officecli-actions { flex-shrink: 0; }.settings-feedback.error { color: #c8645d; }
</style>
