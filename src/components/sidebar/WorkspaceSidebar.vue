<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { WorkspaceProject } from '../../api/plcBridge'
import { getPathParent, normalizePathForComparison, normalizePathForUi } from '../../pathUtils'
import IconTablerFolder from '../icons/IconTablerFolder.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerSettings from '../icons/IconTablerSettings.vue'
import IconTablerSearch from '../icons/IconTablerSearch.vue'
import IconTablerChevronDown from '../icons/IconTablerChevronDown.vue'
import IconTablerTrash from '../icons/IconTablerTrash.vue'
import IconTablerBolt from '../icons/IconTablerBolt.vue'
import ThemeToggle from './ThemeToggle.vue'
import WorkbenchModePicker from './WorkbenchModePicker.vue'
import type { WorkbenchMode } from '../../api/plcBridge'
import type { ThemePreference } from '../../types/theme'

export type SidebarThread = { id: string; name: string; cwd: string; busy: boolean; status: string; persisted: boolean }
const props = defineProps<{ projects: WorkspaceProject[]; threads: SidebarThread[]; activeId: string; theme: ThemePreference; workbenchMode: WorkbenchMode }>()
const emit = defineEmits<{
  'new-thread': [project?: WorkspaceProject]; 'select-thread': [id: string]; 'open-project': [project: WorkspaceProject];
  'add-project': []; 'remove-project': [project: WorkspaceProject]; 'rename-thread': [id: string]; 'delete-thread': [id: string];
  'open-settings': []; 'open-skills': []; 'open-overview': [];
  'update:theme': [theme: ThemePreference];
  'update:workbench-mode': [mode: WorkbenchMode];
}>()
const search = shallowRef('')
const searchOpen = shallowRef(false)
const collapsed = shallowRef(new Set<string>())
const visibleLimit = shallowRef(40)
const filtered = computed(() => props.threads.filter((thread) => `${thread.name} ${thread.cwd}`.toLowerCase().includes(search.value.toLowerCase())))
function projectDirectory(project: WorkspaceProject): string {
  return /\.(project|projectarchive)$/iu.test(project.path) ? getPathParent(project.path) : project.path
}
function belongsToProject(thread: SidebarThread, project: WorkspaceProject): boolean {
  return normalizePathForComparison(thread.cwd) === normalizePathForComparison(projectDirectory(project))
}
const groups = computed(() => props.projects.map((project) => ({ project, threads: filtered.value.filter((thread) => belongsToProject(thread, project)) })))
const ungrouped = computed(() => filtered.value.filter((thread) => !props.projects.some((project) => belongsToProject(thread, project))))
function toggle(id: string): void { const next = new Set(collapsed.value); if (next.has(id)) next.delete(id); else next.add(id); collapsed.value = next }
</script>

<template>
  <aside class="workspace-sidebar">
    <header><strong class="sidebar-brand" aria-label="PLC Pilot"><span class="sidebar-brand-plc">PLC</span><span class="sidebar-brand-pilot">Pilot</span></strong><WorkbenchModePicker :model-value="props.workbenchMode" @update:model-value="emit('update:workbench-mode', $event)" /><button title="搜索会话" aria-label="搜索会话" @click="searchOpen = !searchOpen"><IconTablerSearch /></button><button title="新建临时会话" aria-label="新建临时会话" @click="emit('new-thread')"><IconTablerFilePencil /></button></header>
    <input v-if="searchOpen" v-model="search" class="sidebar-search" aria-label="搜索项目和会话" placeholder="搜索会话" />
    <button class="sidebar-nav" @click="emit('new-thread')"><IconTablerFilePencil /><span>新对话</span></button>
    <button class="sidebar-nav" @click="emit('open-overview')"><IconTablerFolder /><span>工程概览</span></button>
    <button class="sidebar-nav" @click="emit('open-skills')"><IconTablerBolt /><span>Skills 与工具</span></button>
    <div class="sidebar-scroll">
      <div class="group-heading"><span>项目</span><button title="添加项目" aria-label="添加项目" @click="emit('add-project')"><IconTablerFolder /></button></div>
      <section v-for="group in groups" :key="group.project.id" class="project-group">
        <div class="project-heading"><button class="fold-button" :aria-label="`${collapsed.has(group.project.id) ? '展开' : '收起'} ${group.project.name}`" @click="toggle(group.project.id)"><IconTablerChevronDown :class="{ collapsed: collapsed.has(group.project.id) }" /></button><button class="project-name" :title="normalizePathForUi(group.project.path)" @click="emit('open-project', group.project)">{{ group.project.name }}</button><button class="row-action" :aria-label="`在 ${group.project.name} 新建会话`" title="新建项目会话" @click="emit('new-thread', group.project)"><IconTablerFilePencil /></button><button class="row-action" :aria-label="`移除项目 ${group.project.name}`" title="移除项目入口" @click="emit('remove-project', group.project)"><IconTablerTrash /></button></div>
        <div v-if="!collapsed.has(group.project.id)" class="project-threads">
          <div v-for="thread in group.threads.slice(0, visibleLimit)" :key="thread.id" class="thread-row" :class="{ active: activeId === thread.id }">
            <button class="thread-main" :title="thread.status || thread.name" @click="emit('select-thread', thread.id)"><span class="thread-state" :class="{ running: thread.busy }" /><span>{{ thread.name }}</span></button>
            <button v-if="thread.persisted && !thread.busy" class="row-action" title="重命名会话" :aria-label="`重命名 ${thread.name}`" @click="emit('rename-thread', thread.id)"><IconTablerFilePencil /></button><button v-if="!thread.busy" class="row-action" title="删除会话" :aria-label="`删除 ${thread.name}`" @click="emit('delete-thread', thread.id)"><IconTablerTrash /></button>
          </div>
        </div>
      </section>
      <div v-if="ungrouped.length > 0" class="group-heading"><span>其他会话</span><button title="新建临时会话" aria-label="添加临时会话" @click="emit('new-thread')"><IconTablerFilePencil /></button></div>
      <div v-for="thread in ungrouped.slice(0, visibleLimit)" :key="thread.id" class="thread-row" :class="{ active: activeId === thread.id }">
        <button class="thread-main" :title="`${thread.status || thread.name}\n${normalizePathForUi(thread.cwd)}`" @click="emit('select-thread', thread.id)"><span class="thread-state" :class="{ running: thread.busy }" /><span>{{ thread.name }}</span></button><button v-if="thread.persisted && !thread.busy" class="row-action" title="重命名会话" :aria-label="`重命名 ${thread.name}`" @click="emit('rename-thread', thread.id)"><IconTablerFilePencil /></button><button v-if="!thread.busy" class="row-action" title="删除会话" :aria-label="`删除 ${thread.name}`" @click="emit('delete-thread', thread.id)"><IconTablerTrash /></button>
      </div>
      <button v-if="filtered.length > visibleLimit" class="sidebar-nav load-more" @click="visibleLimit += 40">更多会话</button>
    </div>
    <footer><button class="sidebar-nav" @click="emit('open-settings')"><IconTablerSettings /><span>设置</span></button><ThemeToggle :model-value="theme" @update:model-value="emit('update:theme', $event)" /></footer>
  </aside>
</template>

<style scoped>
.workspace-sidebar { --sidebar-bg: #f3f3f3; --sidebar-text: #333; --sidebar-muted: #737373; --sidebar-hover: #e8e8e8; --sidebar-active: #dedede; height: 100%; display: flex; flex-direction: column; min-height: 0; gap: 4px; padding: 10px 8px; background: var(--sidebar-bg); color: var(--sidebar-text); font-size: 13px; }
header { display: flex; align-items: center; gap: 2px; min-height: 30px; padding: 0 4px 8px; }
header strong { font-size: 14px; font-weight: 600; }
.sidebar-brand { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 3px; margin-right: 2px; color: #111; font-size: 13px; font-weight: 650; letter-spacing: 0; line-height: 1; }
.sidebar-brand-plc { color: #111; }
.sidebar-brand-pilot { padding: 3px 4px; border-radius: 4px; background: #f59e0b; color: #111; }
button { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 26px; height: 26px; border: 0; border-radius: 4px; color: inherit; background: transparent; cursor: pointer; }
button:hover { background: var(--sidebar-hover); }
button:focus-visible, input:focus-visible { outline: 2px solid #007acc; outline-offset: -2px; }
svg { width: 16px; height: 16px; flex: 0 0 auto; }
.sidebar-nav { width: 100%; min-height: 32px; gap: 9px; justify-content: flex-start; padding: 0 9px; font-size: 13px; }
.sidebar-search { width: 100%; border: 1px solid var(--sidebar-muted); border-radius: 4px; padding: 6px 8px; background: transparent; color: inherit; }
.sidebar-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; padding-top: 12px; }
.group-heading { display: flex; align-items: center; justify-content: space-between; color: var(--sidebar-muted); min-height: 36px; padding: 0 4px 0 9px; font-size: 12px; }
.project-group { padding-bottom: 8px; }
.project-heading, .thread-row { display: flex; align-items: center; width: 100%; min-width: 0; min-height: 30px; border-radius: 5px; }
.project-name { flex: 1; display: block; min-width: 0; padding: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; }
.fold-button { width: 22px; }
.fold-button svg { width: 12px; transition: transform 180ms ease; }
.fold-button svg.collapsed { transform: rotate(-90deg); }
.project-threads { padding-left: 12px; }
.thread-row:hover { background: var(--sidebar-hover); }
.thread-row.active { background: var(--sidebar-active); }
.thread-main { flex: 1; min-width: 0; justify-content: flex-start; gap: 8px; padding: 0 7px; height: 30px; font-size: 12px; }
.thread-main > span:last-child { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.thread-state { flex: 0 0 5px; width: 5px; height: 5px; border-radius: 50%; background: var(--sidebar-muted); opacity: .6; }
.thread-state.running { flex-basis: 10px; width: 10px; height: 10px; border: 1.5px solid var(--sidebar-muted); border-top-color: transparent; background: none; opacity: 1; animation: sidebar-spin 1.2s linear infinite; }
.row-action { width: 23px; color: var(--sidebar-muted); opacity: 0; }
.row-action svg { width: 13px; height: 13px; }
.thread-row:hover .row-action, .project-heading:hover .row-action, .row-action:focus-visible { opacity: 1; }
footer { display: flex; align-items: center; padding-top: 6px; gap: 4px; }
footer .sidebar-nav { flex: 1; min-width: 0; width: auto; }
.load-more { color: var(--sidebar-muted); }
:global(.dark .workspace-sidebar) { --sidebar-bg: #181818; --sidebar-text: #d4d4d4; --sidebar-muted: #929292; --sidebar-hover: #252526; --sidebar-active: #303030; }
:global(.dark .sidebar-brand), :global(.dark .sidebar-brand-plc), :global(.dark .sidebar-brand-pilot) { color: #fff; }
@keyframes sidebar-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .thread-state.running { animation: none; } }
</style>
