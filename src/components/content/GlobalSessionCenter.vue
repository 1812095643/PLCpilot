<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { searchSessions } from '../../api/plcBridge'
import type { SessionRecord, WorkspaceProject } from '../../api/plcBridge'
import IconTablerSearch from '../icons/IconTablerSearch.vue'
import IconTablerMessageCircle from '../icons/IconTablerMessageCircle.vue'
import IconTablerTrash from '../icons/IconTablerTrash.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'

const props = defineProps<{ sessions: SessionRecord[]; projects: WorkspaceProject[]; activeId: string }>()
const emit = defineEmits<{
  open: [record: SessionRecord]
  rename: [record: SessionRecord]
  delete: [record: SessionRecord]
  notice: [message: string]
}>()

const query = ref('')
const projectFilter = ref('')
const results = ref<SessionRecord[]>([])
const loading = ref(false)
let searchTimer: number | undefined

const projectOptions = computed(() => {
  const values = new Map<string, string>()
  for (const session of props.sessions) {
    const cwd = session.cwd?.trim()
    if (!cwd) continue
    values.set(cwd.toLowerCase(), cwd)
  }
  return [...values.values()].sort((left, right) => left.localeCompare(right))
})

const visibleSessions = computed(() => {
  const source = query.value.trim() ? results.value : props.sessions
  if (!projectFilter.value) return source
  return source.filter((session) => (session.cwd || '').toLowerCase() === projectFilter.value.toLowerCase())
})

function titleOf(session: SessionRecord): string {
  return session.name?.trim() || session.messages.find((message) => message.role === 'user')?.content.slice(0, 48) || '未命名会话'
}

function previewOf(session: SessionRecord): string {
  const message = [...session.messages].reverse().find((item) => item.role === 'assistant' && item.content.trim())
    || session.messages.find((item) => item.role === 'user')
  return message?.content.replace(/\s+/gu, ' ').trim().slice(0, 120) || '暂无正文预览'
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '刚刚'
  const timestamp = Number(value)
  const date = Number.isFinite(timestamp) ? new Date(timestamp * 1000) : new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

async function runSearch(): Promise<void> {
  const value = query.value.trim()
  if (!value) { results.value = []; return }
  loading.value = true
  try { results.value = await searchSessions(value) }
  catch (error) { emit('notice', String(error)); results.value = [] }
  finally { loading.value = false }
}

watch(query, () => {
  if (searchTimer !== undefined) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => { void runSearch() }, 260)
})
</script>

<template>
  <section class="session-center">
    <header class="session-center-header">
      <div>
        <p class="session-eyebrow">GLOBAL RECENTS</p>
        <h1>会话中心</h1>
        <p class="session-lede">跨项目查找、恢复和管理本机保存的所有工作会话。</p>
      </div>
      <div class="session-count"><strong>{{ visibleSessions.length }}</strong><span>个会话</span></div>
    </header>

    <div class="session-filters">
      <label class="session-search"><IconTablerSearch /><input v-model="query" type="search" placeholder="搜索标题、目录或会话正文" aria-label="搜索会话" /><span v-if="loading" class="session-search-loading">搜索中…</span></label>
      <select v-model="projectFilter" aria-label="按项目筛选"><option value="">全部项目</option><option v-for="project in projectOptions" :key="project" :value="project">{{ project }}</option></select>
    </div>

    <div v-if="visibleSessions.length === 0" class="session-empty"><IconTablerMessageCircle /><strong>{{ query ? '没有匹配的会话' : '还没有保存的会话' }}</strong><span>{{ query ? '换一个关键词试试。' : '发送第一条消息后，会话会自动出现在这里。' }}</span></div>
    <div v-else class="session-list">
      <article v-for="session in visibleSessions" :key="session.path" class="session-card" :class="{ active: session.session_id === props.activeId }">
        <button class="session-card-main" type="button" @click="emit('open', session)">
          <span class="session-card-icon"><IconTablerMessageCircle /></span>
          <span class="session-card-copy"><strong>{{ titleOf(session) }}</strong><small>{{ session.cwd || '临时会话' }}</small><em>{{ previewOf(session) }}</em></span>
          <time>{{ formatDate(session.modified_at) }}</time>
        </button>
        <div class="session-card-actions"><button type="button" title="重命名会话" aria-label="重命名会话" @click="emit('rename', session)"><IconTablerFilePencil /></button><button type="button" title="删除会话" aria-label="删除会话" @click="emit('delete', session)"><IconTablerTrash /></button></div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.session-center { min-height: 100%; overflow: auto; padding: 42px clamp(22px, 6vw, 88px) 80px; background: var(--plc-page-bg, #fff); color: var(--plc-text, #222); }
.session-center-header { display: flex; align-items: end; justify-content: space-between; gap: 24px; max-width: 980px; margin: 0 auto 28px; }.session-eyebrow { margin: 0 0 7px; color: #007acc; font-size: 10px; font-weight: 700; letter-spacing: .16em; }.session-center h1 { margin: 0; font-size: 28px; letter-spacing: -.03em; }.session-lede { margin: 9px 0 0; color: var(--plc-muted, #777); font-size: 13px; }.session-count { display: grid; justify-items: end; color: var(--plc-muted, #777); }.session-count strong { color: var(--plc-text, #222); font-size: 25px; }.session-count span { font-size: 11px; }
.session-filters { display: flex; gap: 10px; max-width: 980px; margin: 0 auto 18px; }.session-search { display: flex; align-items: center; gap: 8px; flex: 1; min-height: 38px; padding: 0 12px; border: 1px solid var(--plc-border, #dedede); border-radius: 8px; background: var(--plc-surface, #fafafa); }.session-search svg { width: 16px; color: var(--plc-muted, #888); }.session-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: inherit; font-size: 13px; }.session-search-loading { color: var(--plc-muted, #888); font-size: 11px; }.session-filters select { min-width: 170px; border: 1px solid var(--plc-border, #dedede); border-radius: 8px; padding: 0 10px; background: var(--plc-surface, #fafafa); color: inherit; }
.session-list { display: grid; gap: 7px; max-width: 980px; margin: 0 auto; }.session-card { display: flex; align-items: stretch; border: 1px solid var(--plc-border, #e4e4e4); border-radius: 10px; background: var(--plc-surface, #fff); transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease; }.session-card:hover, .session-card.active { border-color: #6aa8d7; box-shadow: 0 6px 18px #007acc12; transform: translateY(-1px); }.session-card-main { display: flex; align-items: center; flex: 1; min-width: 0; gap: 12px; border: 0; background: transparent; color: inherit; cursor: pointer; text-align: left; padding: 13px 14px; }.session-card-icon { display: grid; place-items: center; width: 29px; height: 29px; flex: 0 0 auto; border-radius: 7px; background: #007acc14; color: #007acc; }.session-card-icon svg { width: 16px; }.session-card-copy { display: grid; min-width: 0; gap: 3px; }.session-card-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }.session-card-copy small, .session-card-copy em { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--plc-muted, #858585); font-size: 11px; font-style: normal; }.session-card-copy em { color: var(--plc-subtle, #999); }.session-card-main time { margin-left: auto; align-self: start; flex: 0 0 auto; color: var(--plc-muted, #888); font-size: 10px; }.session-card-actions { display: flex; align-items: center; gap: 2px; padding: 0 10px; opacity: 0; }.session-card:hover .session-card-actions, .session-card-actions:focus-within { opacity: 1; }.session-card-actions button { width: 27px; height: 27px; border: 0; border-radius: 5px; background: transparent; color: var(--plc-muted, #888); cursor: pointer; }.session-card-actions button:hover { background: var(--plc-hover, #f1f1f1); color: var(--plc-text, #222); }.session-card-actions svg { width: 14px; }
.session-empty { display: grid; justify-items: center; gap: 9px; max-width: 980px; margin: 70px auto; color: var(--plc-muted, #888); text-align: center; }.session-empty svg { width: 30px; height: 30px; opacity: .6; }.session-empty strong { color: var(--plc-text, #333); font-size: 14px; }.session-empty span { font-size: 12px; }
:global(:root.dark) .session-center { --plc-page-bg: #111; --plc-text: #e5e5e5; --plc-muted: #999; --plc-subtle: #777; --plc-border: #303030; --plc-surface: #1a1a1a; --plc-hover: #262626; }.session-center { --plc-page-bg: #fff; --plc-text: #222; --plc-muted: #777; --plc-subtle: #999; --plc-border: #e4e4e4; --plc-surface: #fff; --plc-hover: #f1f1f1; }
@media (max-width: 680px) { .session-center { padding: 24px 14px 48px; }.session-center-header { align-items: start; }.session-filters { flex-direction: column; }.session-filters select { min-height: 38px; }.session-card-main time { display: none; }.session-card-actions { opacity: 1; padding-right: 5px; } }
</style>
