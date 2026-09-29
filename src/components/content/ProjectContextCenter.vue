<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { deleteProjectContext, listProjectContext, saveProjectContext, type ProjectContextRecord, type WorkspaceProject } from '../../api/plcBridge'
import { normalizePathForUi } from '../../pathUtils'
import IconTablerTrash from '../icons/IconTablerTrash.vue'
import SettingsProjectPicker from '../settings/SettingsProjectPicker.vue'
import ProjectContextEditor, { type ContextDraft } from '../settings/ProjectContextEditor.vue'

const props = defineProps<{ projectPath: string; projectName: string; projects: WorkspaceProject[] }>()
const emit = defineEmits<{ notice: [message: string] }>()
const selectedPath = shallowRef(props.projectPath)
const tab = shallowRef<'memory' | 'knowledge'>('memory')
const records = shallowRef<ProjectContextRecord[]>([])
const loading = shallowRef(false)
const saving = shallowRef(false)
const draft = shallowRef<ContextDraft | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const projectOptions = computed(() => props.projects.some(project => project.path === props.projectPath) || !props.projectPath ? props.projects : [...props.projects, { id: 'current', path: props.projectPath, name: props.projectName, exists: true, last_opened_at: '' }])
const visibleRecords = computed(() => records.value.filter(record => tab.value === 'knowledge' ? record.kind === 'knowledge' : record.kind !== 'knowledge'))
const memoryCount = computed(() => records.value.filter(record => record.kind !== 'knowledge').length)
const knowledgeCount = computed(() => records.value.length - memoryCount.value)
let loadGeneration = 0

async function reload(): Promise<void> {
  const generation = ++loadGeneration
  if (!selectedPath.value) { records.value = []; loading.value = false; return }
  loading.value = true
  try {
    const result = await listProjectContext(selectedPath.value)
    if (generation === loadGeneration) records.value = result
  } catch (error) { if (generation === loadGeneration) emit('notice', String(error)) }
  finally { if (generation === loadGeneration) loading.value = false }
}
function startNew(): void { draft.value = { title: '', content: '' } }
function edit(record: ProjectContextRecord): void { draft.value = { id: record.id, title: record.title, content: record.content } }
async function save(value: ContextDraft): Promise<void> {
  if (!selectedPath.value || !value.content.trim()) return
  saving.value = true
  try {
    await saveProjectContext({ projectPath: selectedPath.value, ...value, kind: tab.value === 'knowledge' ? 'knowledge' : 'fact' })
    await reload(); draft.value = null; emit('notice', tab.value === 'knowledge' ? '项目知识已保存。' : '项目记忆已保存。')
  } catch (error) { emit('notice', String(error)) }
  finally { saving.value = false }
}
async function remove(record: ProjectContextRecord): Promise<void> {
  if (!window.confirm('删除“' + record.title + '”吗？')) return
  saving.value = true
  try { await deleteProjectContext(selectedPath.value, record.id); await reload(); if (draft.value?.id === record.id) draft.value = null; emit('notice', '项目上下文已删除。') }
  catch (error) { emit('notice', String(error)) }
  finally { saving.value = false }
}
async function importTextFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const path = selectedPath.value
  try {
    const content = await file.text()
    if (path !== selectedPath.value) return
    tab.value = 'knowledge'
    draft.value = { title: file.name, content }
    emit('notice', '已读取 ' + file.name + '，保存后加入项目知识库。')
  } catch (error) { emit('notice', '读取文件未完成：' + String(error)) }
  finally { input.value = '' }
}
function switchTab(value: 'memory' | 'knowledge'): void { tab.value = value; draft.value = null }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) }
watch(() => props.projectPath, path => { selectedPath.value = path })
watch(selectedPath, () => { draft.value = null; records.value = []; void reload() }, { immediate: true })
</script>

<template>
  <section class="context-management" aria-label="项目上下文">
    <header class="settings-toolbar"><h2>项目上下文</h2><div class="settings-actions"><button v-if="tab === 'knowledge'" class="settings-command" type="button" :disabled="!selectedPath || saving" @click="fileInput?.click()">导入文本</button><button class="settings-command" type="button" :disabled="!selectedPath || saving" @click="startNew">新建条目</button></div></header>
    <SettingsProjectPicker v-model="selectedPath" :projects="projectOptions" :disabled="saving" />
    <p class="settings-feedback context-path" :title="normalizePathForUi(selectedPath)">{{ normalizePathForUi(selectedPath) || '选择项目后，管理这个项目的记忆与知识。' }}</p>
    <div class="settings-tabs" role="tablist" aria-label="上下文类型"><button type="button" role="tab" :aria-selected="tab === 'memory'" :disabled="saving" @click="switchTab('memory')">项目记忆<span>{{ memoryCount }}</span></button><button type="button" role="tab" :aria-selected="tab === 'knowledge'" :disabled="saving" @click="switchTab('knowledge')">项目知识库<span>{{ knowledgeCount }}</span></button></div>
    <input ref="fileInput" hidden type="file" accept=".md,.txt,.json,.html,.htm,.st,.py,.js,.ts,.tsx,.vue,.csv,.xml,.yaml,.yml" @change="importTextFile" />
    <ProjectContextEditor v-if="draft" :draft="draft" :kind="tab" :busy="saving" @save="save" @cancel="draft = null" />
    <div v-if="loading" class="settings-empty" role="status">正在读取项目上下文…</div>
    <div v-else-if="!visibleRecords.length && !draft" class="settings-empty"><strong>{{ tab === 'knowledge' ? '还没有项目知识' : '还没有项目记忆' }}</strong><p>{{ tab === 'knowledge' ? '添加项目说明或导入文本，供后续对话参考。' : '保存项目约定与稳定事实，供同一项目的后续任务参考。' }}</p></div>
    <div v-else class="settings-list"><article v-for="record in visibleRecords" :key="record.id" class="settings-list-row context-row" :class="{ selected: draft?.id === record.id }"><button class="settings-row-copy context-open" type="button" :disabled="saving" @click="edit(record)"><strong>{{ record.title }}</strong><p>{{ record.content.slice(0, 180) }}</p><small>{{ formatDate(record.updated_at) }}<template v-if="record.kind === 'summary'"> · 自动摘要</template></small></button><button class="settings-icon" type="button" :title="'删除 ' + record.title" :aria-label="'删除 ' + record.title" :disabled="saving" @click="remove(record)"><IconTablerTrash /></button></article></div>
  </section>
</template>

<style scoped>
.context-management { min-width: 0; }
.context-management .settings-toolbar { flex-wrap: wrap; gap: 12px; }
.context-path { margin: 9px 0 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.context-row { padding-inline: 4px; gap: 12px; }
.context-row:hover, .context-row.selected { background: color-mix(in srgb, var(--settings-field) 65%, transparent); }
.context-open { border: 0; padding: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.context-open strong, .context-open p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.context-open small { font-size: 11px; }
</style>
