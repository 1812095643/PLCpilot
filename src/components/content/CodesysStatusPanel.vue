<script setup lang="ts">
import { shallowRef } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { Snapshot, ProjectContext } from '../../api/plcBridge'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
const props = defineProps<{ codesys: Snapshot['codesys']; project: ProjectContext }>()
const busy = shallowRef(false)
const result = shallowRef('')
async function launch(): Promise<void> {
  busy.value = true
  try { const started = await invoke<{ pid: number }>('launch_codesys'); result.value = `已发送启动请求 · PID ${started.pid}` } catch (error) { result.value = String(error) } finally { busy.value = false }
}
</script>

<template>
  <section class="codesys-status-panel"><div class="codesys-status-heading"><h2>CODESYS</h2><button type="button" :disabled="busy || !codesys.detected" title="启动已检测到的 CODESYS" @click="launch"><IconTablerArrowUp /><span>{{ busy ? '正在启动' : '启动 CODESYS' }}</span></button></div><dl><dt>可执行文件</dt><dd>{{ codesys.executable || '未检测到安装' }}</dd><dt>Profile</dt><dd>{{ codesys.profile || '未检测到 Profile' }}</dd><dt>工程目录</dt><dd>{{ project.project_directory || project.path || '未选择' }}</dd><dt>程序</dt><dd>{{ result || (codesys.detected ? '已检测到安装' : '未检测到安装') }}</dd><dt>Bridge</dt><dd>{{ project.snapshot_id ? '已读取工程快照' : '未收到工程快照' }}</dd><dt>工程读取</dt><dd>{{ project.exists && project.scan_status === 'scanned' ? '已读取' : project.scan_message || '尚未完成' }}</dd></dl></section>
</template>

<style scoped>
.codesys-status-panel { padding: 20px 0; font-size: 12px; }.codesys-status-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.codesys-status-heading h2 { margin: 0; font-size: 16px; }.codesys-status-heading button { display: flex; align-items: center; gap: 6px; min-height: 28px; padding: 4px 9px; border: 1px solid #9c9c9c; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; }.codesys-status-heading svg { width: 14px; height: 14px; }dl { display: grid; grid-template-columns: 84px minmax(0,1fr); gap: 10px; }dt { color: #818181; }dd { margin: 0; overflow-wrap: anywhere; }button:disabled { opacity: .45; cursor: default; }
</style>
