<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'
import IconTablerChevronDown from '../icons/IconTablerChevronDown.vue'
import { IconCheck as IconTablerCheck } from '@tabler/icons-vue'
import type { WorkbenchMode } from '../../api/plcBridge'
const mode = defineModel<WorkbenchMode>({ required: true })
const open = shallowRef(false)
const root = useTemplateRef<HTMLElement>('root')
const menu = useTemplateRef<HTMLElement>('menu')
const options: Array<{ value: WorkbenchMode; label: string; description: string }> = [
  { value: 'codesys', label: 'codesys', description: 'CODESYS 工程与 PLC 工具' },
  { value: 'chat', label: '自由聊天', description: '通用问答、文件和编程' },
  { value: 'stone', label: 'Stone', description: 'CAREL STone 工程工具' },
]
const selected = computed(() => options.find(item => item.value === mode.value) ?? options[0])
function toggle() { open.value = !open.value; if (open.value) void nextTick(() => menu.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()) }
function select(value: WorkbenchMode) { mode.value = value; open.value = false }
function onOutside(event: PointerEvent) { if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false }
function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') { open.value = false; return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault(); const buttons = [...menu.value?.querySelectorAll<HTMLButtonElement>('button') ?? []]
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  buttons[index]?.focus()
}
onMounted(() => document.addEventListener('pointerdown', onOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside))
</script>
<template>
  <div ref="root" class="workbench-mode-picker"><button type="button" class="workbench-mode-trigger" :aria-expanded="open" aria-haspopup="menu" :title="selected.description" @click="toggle"><span>{{ selected.label }}</span><IconTablerChevronDown :class="{ open }" /></button><div v-if="open" ref="menu" class="workbench-mode-menu" role="menu" aria-label="工作模式" @keydown="onKeyDown"><button v-for="item in options" :key="item.value" type="button" role="menuitemradio" :aria-checked="item.value === mode" @click="select(item.value)"><span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span><IconTablerCheck v-if="item.value === mode" /></button></div></div>
</template>
<style scoped>
.workbench-mode-picker { position: relative; flex: 0 0 auto; }.workbench-mode-trigger { display: inline-flex; align-items: center; gap: 4px; max-width: 148px; height: 25px; padding: 0 7px; border: 0; border-radius: 7px; background: transparent; color: var(--sidebar-text, #333); font-size: 12px; font-weight: 600; cursor: pointer; }.workbench-mode-trigger:hover,.workbench-mode-trigger[aria-expanded=true] { background: var(--sidebar-hover, #e8e8e8); }.workbench-mode-trigger svg { width: 13px; height: 13px; color: var(--sidebar-muted, #737373); transition: transform 160ms ease; }.workbench-mode-trigger svg.open { transform: rotate(180deg); }
.workbench-mode-menu { position: absolute; top: calc(100% + 7px); left: 0; z-index: 600; width: 218px; padding: 5px; border: 1px solid #d5d5d5; border-radius: 8px; background: #fff; color: #333; box-shadow: 0 9px 28px rgb(0 0 0 / 18%); animation: mode-enter 140ms ease-out; }.workbench-mode-menu button { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 10px; min-height: 42px; padding: 7px 8px; border: 0; border-radius: 6px; background: transparent; text-align: left; color: inherit; cursor: pointer; }.workbench-mode-menu button:hover,.workbench-mode-menu button:focus-visible { background: #f0f0f0; outline: none; }.workbench-mode-menu button span { display: grid; gap: 3px; min-width: 0; }.workbench-mode-menu strong { font-size: 12px; font-weight: 600; }.workbench-mode-menu small { color: #777; font-size: 10px; }.workbench-mode-menu svg { width: 15px; height: 15px; flex: 0 0 auto; }
:global(.dark .workbench-mode-menu) { border-color: #3c3c3c; background: #252526; color: #d4d4d4; }:global(.dark .workbench-mode-menu button:hover),:global(.dark .workbench-mode-menu button:focus-visible) { background: #353535; }:global(.dark .workbench-mode-menu small) { color: #999; }
@keyframes mode-enter { from { opacity: 0; transform: translateY(-3px) scale(.98); } to { opacity: 1; transform: none; } } @media (prefers-reduced-motion: reduce) { .workbench-mode-trigger svg { transition: none; } .workbench-mode-menu { animation: none; } }
</style>
