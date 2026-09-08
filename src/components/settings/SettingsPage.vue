<script setup lang="ts">
import { onMounted, reactive, shallowRef } from 'vue'
import { getPreferences, saveRetrySettings, saveAccessMode } from '../../api/settingsBridge'
import type { Snapshot } from '../../api/plcBridge'
import type { ThemePreference } from '../../types/theme'
import McpSettingsPanel from './McpSettingsPanel.vue'
import SkillsSettingsPanel from './SkillsSettingsPanel.vue'
import ToolsSettingsPanel from './ToolsSettingsPanel.vue'
import IconTablerArrowBackUp from '../icons/IconTablerArrowBackUp.vue'
import './settings.css'

const props = defineProps<{ snapshot: Snapshot; theme: ThemePreference }>()
const emit = defineEmits<{ close: []; refresh: []; 'update:theme': [theme: ThemePreference]; notice: [message: string] }>()
const category = defineModel<string>('category', { default: 'models' })
const categories = [{ id: 'models', name: '模型' }, { id: 'mcp', name: 'MCP 服务' }, { id: 'skills', name: 'Skills' }, { id: 'tools', name: '工具目录' }, { id: 'appearance', name: '外观' }, { id: 'retry', name: '重试' }, { id: 'storage', name: '工作区与存储' }, { id: 'updates', name: '软件更新' }]
const retry = reactive({ max_retries: 5, base_delay_ms: 1000, max_delay_ms: 60000 })
const accessMode = shallowRef<'approval' | 'full'>('approval')
const saving = shallowRef(false)
async function saveRetry(): Promise<void> { saving.value = true; try { await saveRetrySettings({ ...retry }); emit('notice', '重试设置已保存。') } catch (error) { emit('notice', String(error)) } finally { saving.value = false } }
async function updateAccessMode(value: 'approval' | 'full'): Promise<void> { accessMode.value = value; try { await saveAccessMode(value); emit('notice', value === 'full' ? '已启用完全访问模式，请确认当前工作区可信。' : '已恢复审批模式。') } catch (error) { emit('notice', String(error)) } }
onMounted(async () => { try { const preferences = await getPreferences(); Object.assign(retry, preferences.retry); if (preferences.access_mode === 'full' || preferences.access_mode === 'approval') accessMode.value = preferences.access_mode } catch (error) { emit('notice', String(error)) } })
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
      <section v-if="category === 'appearance'"><h2>外观</h2><div class="settings-field-row"><label for="app-theme">颜色主题</label><select id="app-theme" :value="theme" @change="emit('update:theme', ($event.target as HTMLSelectElement).value as ThemePreference)"><option value="light">明亮</option><option value="dark">暗黑</option><option value="system">跟随系统</option></select></div></section>
      <form v-if="category === 'retry'" class="settings-form" @submit.prevent="saveRetry"><h2>消息重试</h2><label>最多额外重试次数<input v-model.number="retry.max_retries" type="number" min="0" max="20" required /></label><label>初始等待（毫秒）<input v-model.number="retry.base_delay_ms" type="number" min="100" max="300000" required /></label><label>最大等待（毫秒）<input v-model.number="retry.max_delay_ms" type="number" :min="retry.base_delay_ms" max="300000" required /></label><div><button class="settings-command" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></div><div class="settings-field-row"><label for="access-mode">工具访问模式</label><select id="access-mode" :value="accessMode" @change="updateAccessMode(($event.target as HTMLSelectElement).value as 'approval' | 'full')"><option value="approval">审批模式（推荐）</option><option value="full">完全访问模式</option></select></div><p class="settings-feedback">审批模式会让工程写入、CODESYS 在线操作和命令进入批准/拒绝队列；完全访问模式会直接执行当前已启用工具。计划模式始终只读。</p></form>
      <section v-if="category === 'storage'"><h2>工作区与存储</h2><dl class="settings-storage"><dt>应用配置</dt><dd>{{ snapshot.config_directory }}</dd><dt>工作区与草稿</dt><dd>{{ snapshot.config_directory }}\workspace-state.json</dd><dt>会话记录</dt><dd>{{ snapshot.config_directory }}\sessions</dd><dt>临时工作目录</dt><dd>文档\PLCpilot\日期\时间</dd><dt>模型及服务凭据</dt><dd>{{ snapshot.config_directory }}\auth.json</dd></dl></section>
    </div>
  </section>
</template>
