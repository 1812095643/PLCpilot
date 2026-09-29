<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { SessionRecord } from '../../api/plcBridge'
import { getPathLeafName, normalizePathForUi } from '../../pathUtils'
import IconTablerMessageCircle from '../icons/IconTablerMessageCircle.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerTrash from '../icons/IconTablerTrash.vue'

const props = defineProps<{ session: SessionRecord; active: boolean }>()
const emit = defineEmits<{ open: []; rename: []; delete: []; archive: []; unarchive: [] }>()
const notesOpen = shallowRef(false)
const title = computed(() => props.session.name?.trim() || props.session.messages.find(message => message.role === 'user')?.content.slice(0, 48) || '未命名会话')
const preview = computed(() => {
  const message = [...props.session.messages].reverse().find(item => item.role === 'assistant' && item.content.trim()) || props.session.messages.find(item => item.role === 'user')
  return message?.content.replace(/\s+/gu, ' ').trim().slice(0, 120) || '暂无正文预览'
})
const directory = computed(() => normalizePathForUi(props.session.cwd || ''))
const projectName = computed(() => /(?:^|[\\/])\d{2}-\d{2}-\d{2}-[a-f0-9]+$/iu.test(directory.value) ? '临时会话' : getPathLeafName(directory.value) || '临时会话')
function formatDate(value: string | null | undefined): string {
  if (!value) return '刚刚'
  const timestamp = Number(value)
  const date = Number.isFinite(timestamp) ? new Date(timestamp * 1000) : new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}
</script>

<template>
  <article class="session-row" :class="{ 'is-current': active }">
    <div class="settings-list-row">
      <button class="session-open" type="button" @click="emit('open')">
        <IconTablerMessageCircle class="session-icon" />
        <span class="session-copy"><span class="session-title"><span class="session-name">{{ title }}</span><small v-if="active">当前</small></span><span class="session-preview">{{ preview }}</span><span class="session-meta"><span :title="directory">{{ projectName }}</span><time>{{ formatDate(session.modified_at) }}</time></span></span>
      </button>
      <div class="settings-actions session-actions">
        <button v-if="session.notes?.length" class="settings-command session-text-action" type="button" :aria-expanded="notesOpen" @click="notesOpen = !notesOpen">笔记</button>
        <button class="settings-command session-text-action" type="button" @click="session.archived ? emit('unarchive') : emit('archive')">{{ session.archived ? '恢复' : '归档' }}</button>
        <button class="settings-icon" type="button" :title="`重命名 ${title}`" :aria-label="`重命名 ${title}`" @click="emit('rename')"><IconTablerFilePencil /></button>
        <button class="settings-icon" type="button" :title="`删除 ${title}`" :aria-label="`删除 ${title}`" @click="emit('delete')"><IconTablerTrash /></button>
      </div>
    </div>
    <div v-if="notesOpen" class="session-notes">
      <details v-for="note in session.notes" :key="note.path"><summary :title="normalizePathForUi(note.path)">{{ getPathLeafName(note.path) }}<time>{{ formatDate(note.updated_at) }}</time></summary><pre class="settings-source">{{ note.content }}</pre></details>
    </div>
  </article>
</template>

<style scoped>
.session-row { min-width: 0; border-bottom: 1px solid var(--settings-line); }
.session-row .settings-list-row { gap: 16px; border: 0; padding: 12px 4px; }
.session-row:hover, .session-row.is-current { background: color-mix(in srgb, var(--settings-field) 65%, transparent); }
.session-open { display: flex; flex: 1; align-items: flex-start; min-width: 0; gap: 12px; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.session-icon { flex: 0 0 16px; width: 16px; height: 16px; margin-top: 2px; color: var(--settings-muted); }
.session-copy { display: grid; flex: 1; min-width: 0; gap: 5px; }
.session-title { display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 550; }
.session-title small { flex-shrink: 0; font-size: 10px; font-weight: 400; color: var(--settings-muted); }
.session-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--settings-muted); font-size: 12px; }
.session-meta { display: flex; gap: 12px; min-width: 0; color: var(--settings-muted); font-size: 11px; }
.session-meta span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-meta time { flex-shrink: 0; }
.session-actions { align-self: center; align-items: center; gap: 2px; }
.session-text-action { border-color: transparent; background: transparent; padding-inline: 7px; color: var(--settings-muted); }
.session-text-action:hover { background: var(--settings-field); color: var(--settings-text); }
.session-notes { margin: 0 4px 12px 28px; }
.session-notes summary { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; cursor: pointer; color: var(--settings-muted); font-size: 11px; }
.session-notes time { flex-shrink: 0; }
.session-notes pre { margin: 0 0 8px; }
@media (max-width: 900px) { .session-row .settings-list-row { flex-wrap: wrap; gap: 7px; }.session-open { flex-basis: 100%; }.session-actions { margin-left: 24px; } }
</style>
