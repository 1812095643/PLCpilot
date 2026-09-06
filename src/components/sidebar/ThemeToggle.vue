<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'
import { IconSun, IconMoon, IconDeviceDesktop, IconCheck } from '@tabler/icons-vue'
import type { ThemePreference } from '../../types/theme'

const model = defineModel<ThemePreference>({ required: true })
const open = shallowRef(false)
const root = useTemplateRef<HTMLElement>('root')
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const menu = useTemplateRef<HTMLElement>('menu')
const options = [{ value: 'light' as const, label: '明亮', icon: IconSun }, { value: 'dark' as const, label: '暗黑', icon: IconMoon }, { value: 'system' as const, label: '跟随系统', icon: IconDeviceDesktop }]
const selected = computed(() => options.find((item) => item.value === model.value) ?? options[2]!)
async function toggle(): Promise<void> {
  open.value = !open.value
  if (open.value) { await nextTick(); menu.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus() }
}
function select(value: ThemePreference): void { model.value = value; open.value = false; trigger.value?.focus() }
function onOutside(event: PointerEvent): void { if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false }
function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { open.value = false; trigger.value?.focus(); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const buttons = [...menu.value?.querySelectorAll<HTMLButtonElement>('button') ?? []]
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  buttons[index]?.focus()
}
onMounted(() => document.addEventListener('pointerdown', onOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside))
</script>

<template>
  <div ref="root" class="theme-toggle"><button ref="trigger" type="button" class="theme-trigger" :title="`颜色主题：${selected.label}`" :aria-label="`颜色主题：${selected.label}`" aria-haspopup="menu" :aria-expanded="open" @click="toggle"><component :is="selected.icon" :size="18" stroke="1.7" aria-hidden="true" /></button><Transition name="theme-menu"><div v-if="open" ref="menu" class="theme-menu" role="menu" aria-label="颜色主题" @keydown="onKeyDown"><button v-for="item in options" :key="item.value" type="button" role="menuitemradio" :aria-checked="model === item.value" @click="select(item.value)"><component :is="item.icon" :size="16" stroke="1.7" aria-hidden="true" /><span>{{ item.label }}</span><IconCheck v-if="model === item.value" :size="14" aria-hidden="true" /></button></div></Transition></div>
</template>

<style scoped>
.theme-toggle { position: relative; flex: 0 0 auto; margin-left: auto; }.theme-trigger { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--sidebar-muted, #737373); cursor: pointer; transition: color 160ms ease, background-color 160ms ease; }.theme-trigger:hover { color: var(--sidebar-text, #333); background: var(--sidebar-hover, #e5e5e5); }.theme-trigger svg { transition: transform 180ms ease; }.theme-trigger:hover svg { transform: rotate(-12deg); }.theme-menu { position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 500; width: 164px; padding: 5px; border: 1px solid #d7d7d7; border-radius: 6px; background: #fff; color: #333; box-shadow: 0 6px 20px rgba(0,0,0,.12); }.theme-menu button { display: flex; width: 100%; align-items: center; gap: 9px; padding: 8px; border: 0; border-radius: 4px; background: transparent; color: inherit; font-size: 12px; text-align: left; cursor: pointer; }.theme-menu button span { flex: 1; }.theme-menu button:hover, .theme-menu button:focus-visible { background: #f0f0f0; outline: none; }.theme-menu-enter-active,.theme-menu-leave-active { transition: opacity 140ms ease, transform 140ms ease; }.theme-menu-enter-from,.theme-menu-leave-to { opacity: 0; transform: translateY(4px); }:global(.dark .theme-menu) { border-color: #3c3c3c; background: #252526; color: #d4d4d4; }:global(.dark .theme-menu button:hover),:global(.dark .theme-menu button:focus-visible) { background: #383838; }@media (prefers-reduced-motion: reduce) { .theme-trigger svg,.theme-menu-enter-active,.theme-menu-leave-active { transition: none; } }
</style>
