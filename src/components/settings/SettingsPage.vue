<script setup lang="ts">
import { onMounted, reactive, shallowRef } from 'vue'
import { getPreferences, saveRetrySettings } from '../../api/settingsBridge'
import type { Snapshot } from '../../api/plcBridge'
import type { ThemePreference } from '../../types/theme'
import McpSettingsPanel from './McpSettingsPanel.vue'
import SkillsSettingsPanel from './SkillsSettingsPanel.vue'
import ToolsSettingsPanel from './ToolsSettingsPanel.vue'
import ContextSettingsPanel from './ContextSettingsPanel.vue'
import GeneralSettingsPanel from './GeneralSettingsPanel.vue'
import OfficeCliSettingsPanel from './OfficeCliSettingsPanel.vue'
import IconTablerArrowBackUp from '../icons/IconTablerArrowBackUp.vue'
import IconTablerSearch from '../icons/IconTablerSearch.vue'
import './settings.css'

type SettingsGroup = { label: string; items: Array<{ id: string; name: string; detail: string }> }

const props = defineProps<{ snapshot: Snapshot; theme: ThemePreference; accessMode: 'approval' | 'full'; accessModeDisabled: boolean }>()
const emit = defineEmits<{ close: []; refresh: []; 'update:theme': [theme: ThemePreference]; 'update:access-mode': [mode: 'approval' | 'full']; notice: [message: string] }>()
const category = defineModel<string>('category', { default: 'general' })
const section = defineModel<string>('section', { default: '' })
const search = shallowRef('')
const groups: SettingsGroup[] = [
  { label: '设置', items: [{ id: 'general', name: '通用', detail: '启动、主题、权限与重试' }, { id: 'models', name: '模型', detail: '服务商、模型与上下文' }] },
  { label: '工作区', items: [{ id: 'workspace', name: '工作区', detail: '会话、项目上下文与记忆' }] },
  { label: '能力', items: [{ id: 'extensions', name: '扩展', detail: 'MCP、Skills 与工具目录' }, { id: 'documents', name: '文档引擎', detail: '原生引擎与 OfficeCLI' }] },
  { label: '系统', items: [{ id: 'updates', name: '软件更新', detail: '版本、更新与发布说明' }] },
]
const retry = reactive({ max_retries: 5, base_delay_ms: 1000, max_delay_ms: 60000 })
const saving = shallowRef(false)
const workspaceSections = [{ id: 'sessions', name: '会话管理' }, { id: 'knowledge', name: '项目上下文' }, { id: 'context', name: '记忆设置' }, { id: 'storage', name: '存储位置' }]
const extensionSections = [{ id: 'mcp', name: 'MCP 服务' }, { id: 'skills', name: 'Skills' }, { id: 'tools', name: '工具目录' }]

function visibleGroups(): SettingsGroup[] {
  const query = search.value.trim().toLowerCase()
  if (!query) return groups
  return groups.map(group => ({ ...group, items: group.items.filter(item => `${item.name} ${item.detail}`.toLowerCase().includes(query)) })).filter(group => group.items.length > 0)
}
function selectCategory(value: string): void {
  category.value = value
  if (value === 'workspace' && !workspaceSections.some(item => item.id === section.value)) section.value = 'sessions'
  if (value === 'extensions' && !extensionSections.some(item => item.id === section.value)) section.value = 'mcp'
}
function selectSection(value: string): void { section.value = value }
async function saveRetry(): Promise<void> {
  saving.value = true
  try { await saveRetrySettings({ ...retry }); emit('notice', '重试设置已保存。') }
  catch (error) { emit('notice', String(error)) }
  finally { saving.value = false }
}
function updateAccessMode(event: Event): void {
  const select = event.target as HTMLSelectElement
  const requested = select.value as 'approval' | 'full'
  select.value = props.accessMode
  emit('update:access-mode', requested)
}
onMounted(async () => { try { Object.assign(retry, (await getPreferences()).retry) } catch (error) { emit('notice', String(error)) } })
</script>

<template>
  <section class="settings-page" aria-label="PLC Pilot 设置">
    <nav class="settings-navigation" aria-label="设置分类">
      <div class="settings-nav-heading"><h1>设置</h1><button class="settings-back settings-icon" type="button" aria-label="返回对话" title="返回对话" @click="emit('close')"><IconTablerArrowBackUp /></button></div>
      <label class="settings-search"><IconTablerSearch /><input v-model="search" type="search" aria-label="搜索设置" placeholder="搜索设置" /></label>
      <div class="settings-category-list">
        <section v-for="group in visibleGroups()" :key="group.label" class="settings-nav-group">
          <p>{{ group.label }}</p>
          <button v-for="item in group.items" :key="item.id" type="button" :class="{ active: category === item.id }" :aria-current="category === item.id ? 'page' : undefined" :title="item.detail" @click="selectCategory(item.id)"><strong>{{ item.name }}</strong><small>{{ item.detail }}</small></button>
        </section>
      </div>
      <button class="settings-back settings-back-wide" type="button" @click="emit('close')"><IconTablerArrowBackUp /><span>返回对话</span></button>
    </nav>

    <main class="settings-content">
      <section v-if="category === 'general'" class="settings-view">
        <GeneralSettingsPanel :show-title="false" @notice="emit('notice', $event)" />
        <section class="settings-group-block"><h3>外观</h3><div class="settings-field-row"><span><strong>颜色主题</strong><small>明亮、暗黑或跟随 Windows 系统。</small></span><select id="app-theme" :value="theme" aria-label="颜色主题" @change="emit('update:theme', ($event.target as HTMLSelectElement).value as ThemePreference)"><option value="light">明亮</option><option value="dark">暗黑</option><option value="system">跟随系统</option></select></div></section>
        <form class="settings-group-block settings-form settings-policy" @submit.prevent="saveRetry"><h3>运行策略</h3><div class="settings-field-row"><label for="access-mode">工具访问模式<small>审批模式会在写入、命令和在线操作前等待确认。</small></label><select id="access-mode" :value="accessMode" :disabled="accessModeDisabled" @change="updateAccessMode"><option value="approval">审批模式（推荐）</option><option value="full">完全访问模式</option></select></div><div class="settings-field-row settings-retry-row"><label>消息重试<small>网络临时中断时自动重试，默认最多 5 次。</small></label><div class="settings-retry-fields"><input v-model.number="retry.max_retries" type="number" min="0" max="20" aria-label="最多重试次数" /><span>次</span><input v-model.number="retry.base_delay_ms" type="number" min="100" max="300000" aria-label="初始等待毫秒" /><span>毫秒起</span><button class="settings-command" type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></div></div></form>
      </section>

      <section v-else-if="category === 'models'" class="settings-view"><slot name="models" /></section>

      <section v-else-if="category === 'workspace'" class="settings-view">
        <nav class="settings-subnav" aria-label="工作区设置"><button v-for="item in workspaceSections" :key="item.id" type="button" :class="{ active: section === item.id }" @click="selectSection(item.id)">{{ item.name }}</button></nav>
        <div v-if="section === 'sessions'"><slot name="sessions" /></div>
        <div v-else-if="section === 'knowledge'"><slot name="knowledge" /></div>
        <ContextSettingsPanel v-else-if="section === 'context'" :config-directory="props.snapshot.config_directory" @notice="emit('notice', $event)" />
        <section v-else class="settings-storage-view"><h3>存储位置</h3><p class="settings-feedback">配置、模型凭据、会话和项目记忆都保存在本机，不会因为切换页面而丢失。</p><dl class="settings-storage"><dt>应用配置</dt><dd>{{ snapshot.config_directory }}</dd><dt>工作区与草稿</dt><dd>{{ snapshot.config_directory }}\workspace-state.json</dd><dt>会话记录</dt><dd>{{ snapshot.config_directory }}\sessions</dd><dt>项目记忆</dt><dd>{{ snapshot.config_directory }}\memories\projects</dd><dt>模型及服务凭据</dt><dd>{{ snapshot.config_directory }}\auth.json</dd></dl></section>
      </section>

      <section v-else-if="category === 'extensions'" class="settings-view">
        <nav class="settings-subnav" aria-label="扩展设置"><button v-for="item in extensionSections" :key="item.id" type="button" :class="{ active: section === item.id }" @click="selectSection(item.id)">{{ item.name }}</button></nav>
        <McpSettingsPanel v-if="section === 'mcp'" :summaries="props.snapshot.mcp_servers" @refresh="emit('refresh')" />
        <SkillsSettingsPanel v-else-if="section === 'skills'" :skills="props.snapshot.skills" @refresh="emit('refresh')" />
        <ToolsSettingsPanel v-else :tools="props.snapshot.tools" />
      </section>

      <section v-else-if="category === 'documents'" class="settings-view"><OfficeCliSettingsPanel @notice="emit('notice', $event)" /></section>
      <section v-else-if="category === 'updates'" class="settings-view"><slot name="updates" /></section>
    </main>
  </section>
</template>
