<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { searchSessions } from '../../api/plcBridge'
import type { SessionRecord, WorkspaceProject } from '../../api/plcBridge'
import { normalizePathForComparison } from '../../pathUtils'
import IconTablerSearch from '../icons/IconTablerSearch.vue'
import SettingsProjectPicker from '../settings/SettingsProjectPicker.vue'
import SessionManagementRow from '../settings/SessionManagementRow.vue'

const props = defineProps<{ sessions: SessionRecord[]; projects: WorkspaceProject[]; activeId: string }>()
const emit = defineEmits<{
  open: [record: SessionRecord]
  rename: [record: SessionRecord]
  delete: [record: SessionRecord]
  archive: [record: SessionRecord]
  unarchive: [record: SessionRecord]
  notice: [message: string]
}>()

const query = shallowRef('')
const projectFilter = shallowRef('')
const archiveFilter = shallowRef<'active' | 'archived' | 'all'>('active')
const results = shallowRef<SessionRecord[]>([])
const loading = shallowRef(false)

const projectPaths = computed(() => props.sessions.map(session => session.cwd || '').filter(Boolean))
const filters = [{ value: 'active', label: '最近会话' }, { value: 'archived', label: '已归档' }, { value: 'all', label: '全部' }] as const

const visibleSessions = computed(() => {
  const source = query.value.trim() ? results.value : props.sessions
  return source.filter((session) => {
    if (archiveFilter.value === 'active' && session.archived) return false
    if (archiveFilter.value === 'archived' && !session.archived) return false
    return !projectFilter.value || normalizePathForComparison(session.cwd || '') === normalizePathForComparison(projectFilter.value)
  })
})

watch([query, () => props.sessions], (_values, _oldValues, onCleanup) => {
  const value = query.value.trim()
  results.value = []
  if (!value) { loading.value = false; return }
  let cancelled = false
  loading.value = true
  const timer = window.setTimeout(async () => {
    try {
      const found = await searchSessions(value)
      if (!cancelled) results.value = found
    } catch (error) {
      if (!cancelled) emit('notice', String(error))
    } finally {
      if (!cancelled) loading.value = false
    }
  }, 260)
  onCleanup(() => { cancelled = true; window.clearTimeout(timer) })
})
</script>

<template>
  <section class="session-management" aria-label="会话管理">
    <header class="settings-toolbar"><h2>会话管理</h2><span class="settings-feedback">{{ visibleSessions.length }} 个会话</span></header>
    <div class="session-filters">
      <label class="session-search"><IconTablerSearch /><input v-model="query" type="search" placeholder="搜索标题、目录或会话内容" aria-label="搜索会话" /></label>
      <SettingsProjectPicker v-model="projectFilter" :projects="projects" :paths="projectPaths" include-all />
    </div>
    <div class="settings-tabs" role="tablist" aria-label="会话状态"><button v-for="filter in filters" :key="filter.value" type="button" role="tab" :aria-selected="archiveFilter === filter.value" @click="archiveFilter = filter.value">{{ filter.label }}</button></div>
    <div v-if="loading" class="settings-empty" role="status">正在搜索会话…</div>
    <div v-else-if="!visibleSessions.length" class="settings-empty"><strong>{{ query || projectFilter ? '没有匹配的会话' : archiveFilter === 'archived' ? '还没有归档的会话' : '还没有保存的会话' }}</strong><p>{{ query || projectFilter ? '试试其他关键词或项目。' : '对话会自动保存，归档后仍可在这里恢复。' }}</p></div>
    <div v-else class="settings-list">
      <SessionManagementRow v-for="session in visibleSessions" :key="session.path" :session="session" :active="session.session_id === activeId"
        @open="emit('open', session)" @rename="emit('rename', session)" @delete="emit('delete', session)" @archive="emit('archive', session)" @unarchive="emit('unarchive', session)" />
    </div>
  </section>
</template>

<style scoped>
.session-management { min-width: 0; }
.session-management .settings-toolbar { margin-bottom: 20px; }
.session-filters { display: grid; grid-template-columns: minmax(0, 1fr) minmax(160px, 240px); gap: 12px; margin-bottom: 14px; }
.session-search { display: flex; min-width: 0; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid var(--settings-line); border-radius: 5px; background: var(--settings-field); }
.session-search svg { flex: 0 0 15px; width: 15px; height: 15px; color: var(--settings-muted); }
.session-search input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--settings-text); font-size: 12px; }
.session-search:focus-within { outline: 2px solid var(--settings-muted); outline-offset: 2px; }
.session-search input:focus-visible { outline: 0; }
@media (max-width: 820px) { .session-filters { grid-template-columns: minmax(0, 1fr); gap: 8px; } }
</style>
