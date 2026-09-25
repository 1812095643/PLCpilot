<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { deleteProjectContext, listProjectContext, saveProjectContext } from '../../api/plcBridge'
import type { ProjectContextRecord } from '../../api/plcBridge'
import IconTablerTrash from '../icons/IconTablerTrash.vue'
import IconTablerBolt from '../icons/IconTablerBolt.vue'

const props = defineProps<{ projectPath: string; projectName: string }>()
const emit = defineEmits<{ notice: [message: string] }>()
const tab = ref<'memory' | 'knowledge'>('memory')
const records = ref<ProjectContextRecord[]>([])
const loading = ref(false)
const saving = ref(false)
const editingId = ref<string | undefined>()
const title = ref('')
const content = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const visibleRecords = computed(() => records.value.filter((record) => tab.value === 'knowledge' ? record.kind === 'knowledge' : record.kind !== 'knowledge'))
const emptyLabel = computed(() => tab.value === 'knowledge' ? '这个项目还没有知识条目' : '这个项目还没有持久化记忆')

async function reload(): Promise<void> {
  if (!props.projectPath) { records.value = []; return }
  loading.value = true
  try { records.value = await listProjectContext(props.projectPath) }
  catch (error) { emit('notice', String(error)) }
  finally { loading.value = false }
}

function resetEditor(): void { editingId.value = undefined; title.value = ''; content.value = '' }
function startNew(): void { resetEditor(); tab.value === 'knowledge' ? (title.value = '新的项目知识') : (title.value = '新的项目记忆') }
function edit(record: ProjectContextRecord): void { editingId.value = record.id; title.value = record.title; content.value = record.content }
async function save(): Promise<void> {
  if (!props.projectPath || !content.value.trim()) return
  saving.value = true
  try {
    await saveProjectContext({ projectPath: props.projectPath, id: editingId.value, kind: tab.value === 'knowledge' ? 'knowledge' : 'fact', title: title.value, content: content.value })
    await reload(); resetEditor(); emit('notice', tab.value === 'knowledge' ? '项目知识已保存。' : '项目记忆已保存。')
  } catch (error) { emit('notice', String(error)) }
  finally { saving.value = false }
}
async function remove(record: ProjectContextRecord): Promise<void> {
  if (!window.confirm(`删除“${record.title}”吗？`)) return
  try { await deleteProjectContext(props.projectPath, record.id); await reload(); if (editingId.value === record.id) resetEditor(); emit('notice', '项目上下文已删除。') }
  catch (error) { emit('notice', String(error)) }
}
async function importTextFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try { title.value = file.name; content.value = await file.text(); tab.value = 'knowledge'; editingId.value = undefined; emit('notice', `已读取 ${file.name}，保存后会加入项目知识库。`) }
  catch (error) { emit('notice', `读取文件未完成：${String(error)}`) }
  ;(event.target as HTMLInputElement).value = ''
}
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) }
watch(() => props.projectPath, () => { resetEditor(); void reload() })
onMounted(() => { void reload() })
</script>

<template>
  <section class="context-center">
    <header class="context-header"><div><p class="context-eyebrow">PROJECT CONTEXT</p><h1>{{ projectName || '当前项目' }}</h1><p>{{ projectPath || '选择项目后即可管理项目级记忆和知识。' }}</p></div><IconTablerBolt class="context-mark" /></header>
    <div class="context-tabs"><button :class="{ active: tab === 'memory' }" type="button" @click="tab = 'memory'">项目记忆 <span>{{ records.filter((record) => record.kind !== 'knowledge').length }}</span></button><button :class="{ active: tab === 'knowledge' }" type="button" @click="tab = 'knowledge'">项目知识库 <span>{{ records.filter((record) => record.kind === 'knowledge').length }}</span></button><span class="context-tab-spacer" /><button type="button" @click="startNew">新建</button><button v-if="tab === 'knowledge'" type="button" @click="fileInput?.click()">导入文本</button><input ref="fileInput" hidden type="file" accept=".md,.txt,.json,.html,.htm,.st,.py,.js,.ts,.tsx,.vue,.csv,.xml,.yaml,.yml" @change="importTextFile" /></div>
    <div class="context-layout">
      <div class="context-list">
        <div v-if="loading" class="context-empty">正在读取项目上下文…</div><div v-else-if="visibleRecords.length === 0" class="context-empty"><strong>{{ emptyLabel }}</strong><span>把稳定事实、接口约定和项目说明放在这里，后续任务会按项目自动参考。</span></div>
        <article v-for="record in visibleRecords" :key="record.id" class="context-card" :class="{ selected: editingId === record.id }"><button class="context-card-main" type="button" @click="edit(record)"><strong>{{ record.title }}</strong><small>{{ formatDate(record.updated_at) }} · {{ record.kind === 'knowledge' ? '知识条目' : record.kind === 'summary' ? '自动摘要' : '记忆' }}</small><p>{{ record.content.slice(0, 180) }}</p></button><button class="context-card-delete" type="button" title="删除" aria-label="删除上下文" @click="remove(record)"><IconTablerTrash /></button></article>
      </div>
      <form class="context-editor" @submit.prevent="save"><div class="context-editor-heading"><div><span>{{ editingId ? '编辑条目' : '新建条目' }}</span><small>{{ tab === 'knowledge' ? '项目知识库' : '项目记忆' }}</small></div><button v-if="editingId" type="button" @click="resetEditor">取消</button></div><input v-model="title" required maxlength="100" :placeholder="tab === 'knowledge' ? '例如：设备通信协议' : '例如：项目约定'" /><textarea v-model="content" required :maxlength="tab === 'knowledge' ? 50000 : 12000" :placeholder="tab === 'knowledge' ? '粘贴项目说明、接口约定、调试记录或规范…' : '只记录可复用、可验证的事实，不记录凭据…'" /><div class="context-editor-footer"><span>{{ content.length }} 字符</span><button type="submit" :disabled="saving || !content.trim()">{{ saving ? '保存中…' : '保存到项目' }}</button></div></form>
    </div>
  </section>
</template>

<style scoped>
.context-center { min-height: 100%; overflow: auto; padding: 42px clamp(22px, 6vw, 88px) 80px; background: var(--ctx-bg, #fff); color: var(--ctx-text, #222); }.context-header { display: flex; align-items: start; justify-content: space-between; max-width: 1080px; margin: 0 auto 26px; }.context-eyebrow { margin: 0 0 7px; color: #007acc; font-size: 10px; font-weight: 700; letter-spacing: .16em; }.context-header h1 { margin: 0; font-size: 27px; letter-spacing: -.03em; }.context-header p:last-child { max-width: 720px; margin: 9px 0 0; overflow: hidden; color: var(--ctx-muted, #888); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.context-mark { width: 30px; height: 30px; color: #007acc; }
.context-tabs { display: flex; align-items: center; gap: 6px; max-width: 1080px; margin: 0 auto 16px; border-bottom: 1px solid var(--ctx-border, #e4e4e4); }.context-tabs button { min-height: 34px; border: 0; border-bottom: 2px solid transparent; padding: 0 10px; background: transparent; color: var(--ctx-muted, #888); cursor: pointer; font-size: 12px; }.context-tabs button.active { border-bottom-color: #007acc; color: var(--ctx-text, #222); }.context-tabs button span { margin-left: 4px; font-size: 10px; }.context-tabs button:hover { color: var(--ctx-text, #222); }.context-tab-spacer { flex: 1; }
.context-layout { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(280px, .85fr); gap: 14px; max-width: 1080px; margin: 0 auto; }.context-list { display: grid; align-content: start; gap: 7px; min-width: 0; }.context-card { display: flex; min-width: 0; border: 1px solid var(--ctx-border, #e4e4e4); border-radius: 9px; background: var(--ctx-surface, #fff); }.context-card.selected, .context-card:hover { border-color: #6aa8d7; }.context-card-main { flex: 1; min-width: 0; padding: 12px 13px; border: 0; background: transparent; color: inherit; cursor: pointer; text-align: left; }.context-card-main strong, .context-card-main small, .context-card-main p { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.context-card-main strong { font-size: 13px; }.context-card-main small { margin-top: 4px; color: var(--ctx-muted, #888); font-size: 10px; }.context-card-main p { margin: 7px 0 0; color: var(--ctx-subtle, #999); font-size: 11px; }.context-card-delete { width: 32px; border: 0; background: transparent; color: var(--ctx-muted, #888); cursor: pointer; opacity: 0; }.context-card:hover .context-card-delete, .context-card-delete:focus-visible { opacity: 1; }.context-card-delete svg { width: 14px; }.context-empty { display: grid; justify-items: center; gap: 8px; padding: 44px 18px; color: var(--ctx-muted, #888); font-size: 12px; text-align: center; }.context-empty strong { color: var(--ctx-text, #333); }
.context-editor { display: grid; align-content: start; gap: 9px; position: sticky; top: 10px; min-height: 280px; padding: 15px; border: 1px solid var(--ctx-border, #e4e4e4); border-radius: 10px; background: var(--ctx-surface, #fff); }.context-editor-heading { display: flex; align-items: center; justify-content: space-between; }.context-editor-heading div { display: grid; gap: 3px; }.context-editor-heading span { font-size: 13px; font-weight: 650; }.context-editor-heading small { color: var(--ctx-muted, #888); font-size: 10px; }.context-editor-heading button { border: 0; background: transparent; color: #007acc; cursor: pointer; font-size: 11px; }.context-editor input, .context-editor textarea { width: 100%; border: 1px solid var(--ctx-border, #d9d9d9); border-radius: 7px; outline: 0; background: var(--ctx-field, #fafafa); color: inherit; font: inherit; font-size: 12px; }.context-editor input { height: 34px; padding: 0 9px; }.context-editor textarea { min-height: 260px; resize: vertical; padding: 9px; line-height: 1.65; }.context-editor input:focus, .context-editor textarea:focus { border-color: #007acc; box-shadow: 0 0 0 2px #007acc1c; }.context-editor-footer { display: flex; align-items: center; justify-content: space-between; color: var(--ctx-muted, #888); font-size: 10px; }.context-editor-footer button { border: 0; border-radius: 6px; padding: 8px 12px; background: #007acc; color: #fff; cursor: pointer; font-size: 11px; }.context-editor-footer button:disabled { cursor: default; opacity: .45; }
.context-center { --ctx-bg: #fff; --ctx-text: #222; --ctx-muted: #777; --ctx-subtle: #999; --ctx-border: #e4e4e4; --ctx-surface: #fff; --ctx-field: #fafafa; }.context-center :deep(button:focus-visible), .context-center :deep(input:focus-visible), .context-center :deep(textarea:focus-visible) { outline: 2px solid #007acc; outline-offset: 1px; }.context-center :deep(select) { color: inherit; }:global(:root.dark) .context-center { --ctx-bg: #111; --ctx-text: #e5e5e5; --ctx-muted: #999; --ctx-subtle: #777; --ctx-border: #303030; --ctx-surface: #1a1a1a; --ctx-field: #151515; }
@media (max-width: 820px) { .context-center { padding: 24px 14px 48px; }.context-layout { grid-template-columns: 1fr; }.context-editor { position: static; }.context-header p:last-child { max-width: 72vw; } }
</style>
