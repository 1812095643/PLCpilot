<script setup lang="ts">
import { onMounted, reactive, shallowRef } from 'vue'
import { getPreferences, saveRetrySettings } from '../../api/settingsBridge'
import type { Snapshot } from '../../api/plcBridge'
import type { ThemePreference } from '../../types/theme'
import McpSettingsPanel from './McpSettingsPanel.vue'
import SkillsSettingsPanel from './SkillsSettingsPanel.vue'
import ToolsSettingsPanel from './ToolsSettingsPanel.vue'
import ContextSettingsPanel from './ContextSettingsPanel.vue'
import IconTablerArrowBackUp from '../icons/IconTablerArrowBackUp.vue'
import './settings.css'

const props = defineProps<{ snapshot: Snapshot; theme: ThemePreference; accessMode: 'approval' | 'full'; accessModeDisabled: boolean }>()
const emit = defineEmits<{ close: []; refresh: []; 'update:theme': [theme: ThemePreference]; 'update:access-mode': [mode: 'approval' | 'full']; notice: [message: string] }>()
const category = defineModel<string>('category', { default: 'models' })
const categories = [{ id: 'models', name: '模型' }, { id: 'mcp', name: 'MCP 服务' }, { id: 'skills', name: 'Skills' }, { id: 'tools', name: '工具目录' }, { id: 'context', name: '记忆与上下文' }, { id: 'appearance', name: '外观' }, { id: 'retry', name: '重试' }, { id: 'storage', name: '工作区与存储' }, { id: 'updates', name: '软件更新' }]
const retry = reactive({ max_retries: 5, base_delay_ms: 1000, max_delay_ms: 60000 })
const saving = shallowRef(false)
async function saveRetry(): Promise<void> { saving.value = true; try { await saveRetrySettings({ ...retry }); emit('notice', '重试设置已保存。') } catch (error) { emit('notice', String(error)) } finally { saving.value = false } }
function updateAccessMode(event: Event): void {
  const select = event.target as HTMLSelectElement
  const requested = select.value as 'approval' | 'full'
  select.value = props.accessMode
  emit('update:access-mode', requested)
}
onMounted(async () => { try { const preferences = await getPreferences(); Object.assign(retry, preferences.retry) } catch (error) { emit('notice', String(error)) } })
</script>

<template>
  <section class="settings-page" aria-label="PLC Pilot 设置">
    <nav class="settings-navigation" aria-label="设置分类"><h1>设置</h1><button class="settings-back" @click="emit('close')"><IconTablerArrowBackUp /><span>返回对话</span></button><button v-for="item in categories" :key="item.id" :class="{ active: category === item.id }" @click="category = item.id">{{ item.name }}</button></nav>
    <div class="settings-content">
      <div v-show="category === 'models'"><slot name="models" /></div>
      <div v-if="category === 'updates'"><slot name="updates" /></div>
      <McpSettingsPanel v-if="category === 'mcp'" :summaries="props.snapshot.mcp_servers" @refresh="emit('refresh')" />
      <SkillsSettingsPanel v-if="category === 'skills'" :skills="props.snapshot.skills" @refresh="emit('refresh')" />
      <ToolsSettingsPanel v-if="category === 'tools'" :tools="props.snapshot.tools" />
      <ContextSettingsPanel v-if="category === 'context'" :config-directory="props.snapshot.config_directory" @notice="emit('notice', $event)" />
      <section v-if="category === 'appearance'"><h2>外观</h2><div class="settings-field-row"><label for="app-theme">颜色主题</label><select id="app-theme" :value="theme" @change="emit('update:theme', ($event.target as HTMLSelectElement).value as ThemePreference)"><option value="light">明亮</option><option value="dark">暗黑</option><option value="system">跟随系统</option></select></div></section>
      <form v-if="category === 'retry'" class="settings-form" @submit.prevent="saveRetry"><h2>消息重试</h2><label>最多额外重试次数<input v-model.number="retry.max_retries" type="number" min="0" max="20" required /></label><label>初始等待（毫秒）<input v-model.number="retry.base_delay_ms" type="number" min="100" max="300000" required /></label><label>最大等待（毫秒）<input v-model.number="retry.max_delay_ms" type="number" :min="retry.base_delay_ms" max="300000" required /></label><div><button class="settings-command" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></div><div class="settings-field-row"><label for="access-mode">工具访问模式</label><select id="access-mode" :value="accessMode" :disabled="accessModeDisabled" @change="updateAccessMode"><option value="approval">审批模式（推荐）</option><option value="full">完全访问模式</option></select></div><p class="settings-feedback">审批模式会让工程写入、CODESYS 在线操作和命令进入批准/拒绝队列；完全访问模式会直接执行当前已启用工具。计划模式始终只读。任务运行期间暂不可切换权限。</p></form>
      <section v-if="category === 'storage'"><h2>工作区与存储</h2><dl class="settings-storage"><dt>应用配置</dt><dd>{{ snapshot.config_directory }}</dd><dt>工作区与草稿</dt><dd>{{ snapshot.config_directory }}\workspace-state.json</dd><dt>会话记录</dt><dd>{{ snapshot.config_directory }}\sessions</dd><dt>临时工作目录</dt><dd>文档\PLCpilot\日期\时间</dd><dt>模型及服务凭据</dt><dd>{{ snapshot.config_directory }}\auth.json</dd></dl></section>
    </div>
  </section>
</template>
