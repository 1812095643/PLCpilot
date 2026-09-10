<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, shallowRef, useTemplateRef } from 'vue'
import { IconCheck, IconChevronDown, IconShieldCheck, IconShieldOff } from '@tabler/icons-vue'

const props = defineProps<{ mode: 'approval' | 'full'; disabled?: boolean; plan?: boolean }>()
const emit = defineEmits<{ select: [mode: 'approval' | 'full'] }>()
const expanded = shallowRef(false)
const root = useTemplateRef('root')
const trigger = useTemplateRef('trigger')
const title = computed(() => props.plan ? '计划 · 只读' : props.mode === 'full' ? '完全访问' : '需要审批')
const options = [
  { mode: 'approval' as const, title: '需要审批', detail: '写入、命令与在线操作先由你批准。', icon: IconShieldCheck },
  { mode: 'full' as const, title: '完全访问', detail: '无需审批，直接执行已启用工具。', icon: IconShieldOff },
]

async function open(): Promise<void> {
  expanded.value = !expanded.value
  if (!expanded.value) return
  window.addEventListener('pointerdown', outside)
  await nextTick()
  root.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
}
function close(): void {
  expanded.value = false
  window.removeEventListener('pointerdown', outside)
}
function outside(event: PointerEvent): void { if (!root.value?.contains(event.target as Node)) close() }
function select(mode: 'approval' | 'full'): void { close(); trigger.value?.focus(); emit('select', mode) }
function keyboard(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); close(); trigger.value?.focus() }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const buttons = Array.from(root.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
  }
}
onBeforeUnmount(close)
</script>

<template>
  <div ref="root" class="composer-access" @focusout="(event) => { if (!root?.contains(event.relatedTarget as Node)) close() }" @keydown="keyboard">
    <button ref="trigger" type="button" class="access-trigger" :disabled="disabled || plan" aria-haspopup="menu" :aria-expanded="expanded" :title="plan ? '计划模式只允许读取' : '工具访问权限'" @click="open"><component :is="mode === 'full' && !plan ? IconShieldOff : IconShieldCheck" :size="14" stroke="1.5" /><span>{{ title }}</span><IconChevronDown :size="11" /></button>
    <div v-if="expanded" class="access-menu" role="menu" aria-label="工具访问权限">
      <button v-for="option in options" :key="option.mode" type="button" role="menuitemradio" :aria-checked="mode === option.mode" @click="select(option.mode)"><component :is="option.icon" :size="16" stroke="1.5" /><span><strong>{{ option.title }}</strong><small>{{ option.detail }}</small></span><IconCheck v-if="mode === option.mode" :size="14" /></button>
    </div>
  </div>
</template>

<style scoped>
.composer-access { position:relative; }
.access-trigger { display:flex; align-items:center; gap:5px; min-height:28px; padding:3px 6px; border:0; border-radius:5px; background:transparent; color:var(--composer-muted); font-size:11px; white-space:nowrap; cursor:pointer; }
.access-trigger:hover { background:var(--composer-soft); color:var(--composer-text); }
.access-trigger:disabled { cursor:default; opacity:.55; }
.access-menu { position:absolute; left:0; bottom:calc(100% + 7px); z-index:40; width:258px; max-width:calc(100vw - 36px); padding:5px; border-radius:9px; background:var(--composer-bg); color:var(--composer-text); box-shadow:0 0 0 1px var(--composer-soft),0 5px 24px #0002; animation:access-enter 130ms ease-out; }
.access-menu button { display:flex; align-items:center; gap:9px; width:100%; padding:9px 7px; border:0; border-radius:5px; color:inherit; background:transparent; text-align:left; cursor:pointer; }
.access-menu button:hover,.access-menu button:focus-visible { background:var(--composer-soft); }
.access-menu button span { flex:1; }
.access-menu strong { display:block; font-size:12px; font-weight:500; }
.access-menu small { display:block; margin-top:4px; font-size:11px; line-height:1.5; color:var(--composer-muted); }
.access-trigger:focus-visible,.access-menu button:focus-visible { outline:2px solid var(--composer-muted); outline-offset:1px; }
@keyframes access-enter { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:translateY(0); } }
@media(prefers-reduced-motion:reduce) { .access-menu { animation:none; } }
</style>
