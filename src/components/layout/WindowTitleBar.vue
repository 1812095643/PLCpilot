<script setup lang="ts">
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerFolder from '../icons/IconTablerFolder.vue'
import IconTablerLayoutSidebar from '../icons/IconTablerLayoutSidebar.vue'
import IconTablerLayoutSidebarFilled from '../icons/IconTablerLayoutSidebarFilled.vue'
import IconTablerSearch from '../icons/IconTablerSearch.vue'
import IconTablerSettings from '../icons/IconTablerSettings.vue'
import IconTablerBolt from '../icons/IconTablerBolt.vue'

const props = withDefaults(defineProps<{
  title?: string
  isSidebarCollapsed?: boolean
  showSidebarToggle?: boolean
}>(), {
  title: 'PLC Pilot',
  isSidebarCollapsed: false,
  showSidebarToggle: true,
})

const emit = defineEmits<{
  'toggle-sidebar': []
  'open-chat': []
  'start-new-thread': []
  'open-project': []
  'open-command-palette': []
  'open-skills': []
  'open-settings': []
  'window-error': [message: string]
  'open-about': []
  'open-reward': []
  'open-github': []
  'check-updates': []
}>()

type MenuKey = 'file' | 'edit' | 'view' | 'help'
type MenuItem = {
  label: string
  action: () => void
}

const activeMenu = shallowRef<MenuKey | null>(null)
const isMaximized = shallowRef(false)
const isDesktopRuntime = typeof window !== 'undefined' && isTauri()
let stopWindowResize: UnlistenFn | undefined
let isDisposed = false

const menus: Array<{ key: MenuKey; label: string }> = [
  { key: 'file', label: '文件' },
  { key: 'edit', label: '编辑' },
  { key: 'view', label: '视图' },
  { key: 'help', label: '帮助' },
]

function menuItems(key: MenuKey): MenuItem[] {
  switch (key) {
    case 'file':
      return [
        { label: '新建会话', action: () => emit('start-new-thread') },
        { label: '打开项目文件夹', action: () => emit('open-project') },
      ]
    case 'edit':
      return [{ label: '命令面板', action: () => emit('open-command-palette') }]
    case 'view':
      return [
        { label: props.isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏', action: () => emit('toggle-sidebar') },
        { label: '打开对话', action: () => emit('open-chat') },
        { label: '打开 Skills', action: () => emit('open-skills') },
      ]
    case 'help':
      return [
        { label: '工作台设置', action: () => emit('open-settings') },
        { label: '检查更新', action: () => emit('check-updates') },
        { label: '关于作者 · 蔡徐坤', action: () => emit('open-about') },
        { label: '打赏作者', action: () => emit('open-reward') },
        { label: 'GitHub · PLCpilot', action: () => emit('open-github') },
        { label: '命令面板', action: () => emit('open-command-palette') },
      ]
  }
}

function toggleMenu(key: MenuKey): void {
  activeMenu.value = activeMenu.value === key ? null : key
}

function closeMenu(): void {
  activeMenu.value = null
}

function runMenuItem(item: MenuItem): void {
  closeMenu()
  item.action()
}

async function withWindow(action: (window: ReturnType<typeof getCurrentWindow>) => Promise<void>): Promise<void> {
  if (!isDesktopRuntime) {
    emit('window-error', '浏览器预览不支持窗口控制，请在 PLC Pilot 桌面程序中使用。')
    return
  }
  try {
    await action(getCurrentWindow())
  } catch (error) {
    emit('window-error', `窗口操作尚未完成：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function refreshMaximizedState(): Promise<void> {
  if (!isDesktopRuntime) return
  try {
    isMaximized.value = await getCurrentWindow().isMaximized()
  } catch {
    isMaximized.value = false
  }
}

function minimizeWindow(): void {
  void withWindow((window) => window.minimize())
}

async function toggleMaximizeWindow(): Promise<void> {
  await withWindow((window) => window.toggleMaximize())
  await refreshMaximizedState()
}

function closeWindow(): void {
  void withWindow((window) => window.close())
}

function startWindowDrag(event: MouseEvent): void {
  if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return
  // 按 Tauri 标题栏事件契约在第二次按下时最大化，避免 startDragging 接管鼠标后
  // 吞掉浏览器 dblclick；按钮所在区域始终保留原本的点击行为。
  if (event.detail === 2) void toggleMaximizeWindow()
  else void withWindow((window) => window.startDragging())
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target
  if (!(target instanceof Element) || !target.closest('.window-titlebar-menu')) closeMenu()
}

onMounted(async () => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  if (!isDesktopRuntime) return
  await refreshMaximizedState()
  // Windows 贴边、双击标题栏等原生操作同样会改变窗口状态，不能只在按钮点击后刷新。
  try {
    const unlisten = await getCurrentWindow().onResized(() => void refreshMaximizedState())
    if (isDisposed) unlisten()
    else stopWindowResize = unlisten
  } catch (error) {
    emit('window-error', `无法同步窗口状态：${String(error)}`)
  }
})

onBeforeUnmount(() => {
  isDisposed = true
  stopWindowResize?.()
  document.removeEventListener('pointerdown', onDocumentPointerDown)
})
</script>

<template>
  <div class="window-titlebar" @mousedown="startWindowDrag">
    <div class="window-titlebar-leading">
      <button
        v-if="showSidebarToggle"
        type="button"
        class="window-titlebar-icon-button"
        :aria-label="isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
        :title="isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
        @click.stop="emit('toggle-sidebar')"
      >
        <IconTablerLayoutSidebarFilled v-if="isSidebarCollapsed" aria-hidden="true" />
        <IconTablerLayoutSidebar v-else aria-hidden="true" />
      </button>
    </div>

    <nav class="window-titlebar-menus" aria-label="应用菜单">
      <div v-for="menu in menus" :key="menu.key" class="window-titlebar-menu">
        <button
          type="button"
          class="window-titlebar-menu-trigger"
          :aria-expanded="activeMenu === menu.key"
          @click.stop="toggleMenu(menu.key)"
        >
          {{ menu.label }}
        </button>
        <div v-if="activeMenu === menu.key" class="window-titlebar-menu-popover" role="menu">
          <button v-for="item in menuItems(menu.key)" :key="item.label" type="button" role="menuitem" @click.stop="runMenuItem(item)">
            <span>{{ item.label }}</span>
          </button>
        </div>
      </div>
    </nav>

    <div class="window-titlebar-drag-region" aria-hidden="true" />

    <div class="window-titlebar-actions">
      <button type="button" class="window-titlebar-action" aria-label="最小化" title="最小化" @click.stop="minimizeWindow">
        <span class="window-glyph window-glyph-minimize" aria-hidden="true" />
      </button>
      <button type="button" class="window-titlebar-action" :aria-label="isMaximized ? '还原' : '最大化'" :title="isMaximized ? '还原' : '最大化'" @click.stop="toggleMaximizeWindow">
        <span class="window-glyph" :class="isMaximized ? 'window-glyph-restore' : 'window-glyph-maximize'" aria-hidden="true" />
      </button>
      <button type="button" class="window-titlebar-action window-titlebar-close" aria-label="关闭" title="关闭" @click.stop="closeWindow">
        <span class="window-glyph window-glyph-close" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.window-titlebar {
  --titlebar-bg: #f3f3f3;
  --titlebar-border: #d7d7d7;
  --titlebar-text: #333333;
  --titlebar-muted: #5f5f5f;
  --titlebar-hover: #e5e5e5;
  --titlebar-menu: #ffffff;
  display: flex;
  align-items: center;
  width: 100%;
  height: 34px;
  min-width: 0;
  border-bottom: 1px solid var(--titlebar-border);
  background: var(--titlebar-bg);
  color: var(--titlebar-text);
  user-select: none;
}

.window-titlebar-leading,
.window-titlebar-actions,
.window-titlebar-menus {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  height: 100%;
}

.window-titlebar-leading { gap: 2px; padding-left: 6px; }
.window-titlebar-actions { margin-left: auto; }
.window-titlebar-drag-region { flex: 1 1 auto; min-width: 16px; height: 100%; }

.window-titlebar-icon-button,
.window-titlebar-menu-trigger,
.window-titlebar-action,
.window-titlebar-brand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.window-titlebar-icon-button { width: 28px; border-radius: 4px; color: var(--titlebar-muted); }
.window-titlebar-icon-button:hover,
.window-titlebar-menu-trigger:hover,
.window-titlebar-menu-trigger[aria-expanded='true'] { background: var(--titlebar-hover); color: var(--titlebar-text); }
.window-titlebar-icon-button svg { width: 16px; height: 16px; }

.window-titlebar-brand { gap: 7px; padding: 0 8px 0 4px; color: var(--titlebar-text); }
.window-titlebar-brand:hover { background: var(--titlebar-hover); }
.window-titlebar-mark { display: inline-flex; width: 19px; height: 19px; align-items: center; justify-content: center; border-radius: 4px; background: #007acc; color: #fff; font-size: 11px; font-weight: 700; }
.window-titlebar-title { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; }

.window-titlebar-menus { gap: 1px; margin-left: 2px; }
.window-titlebar-menu { position: relative; height: 100%; display: flex; align-items: center; }
.window-titlebar-menu-trigger { padding: 0 8px; border-radius: 4px; color: var(--titlebar-muted); font-size: 12px; }
.window-titlebar-menu-popover { position: absolute; top: 31px; left: 0; z-index: 500; min-width: 168px; padding: 4px; border: 1px solid var(--titlebar-border); border-radius: 5px; background: var(--titlebar-menu); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.16); }
.window-titlebar-menu-popover button { display: flex; width: 100%; align-items: center; justify-content: flex-start; min-height: 28px; padding: 0 9px; border: 0; border-radius: 3px; background: transparent; color: var(--titlebar-text); font-size: 12px; text-align: left; }
.window-titlebar-menu-popover button:hover { background: #e8f2fb; color: #005a9e; }

.window-titlebar-action { width: 46px; color: var(--titlebar-muted); }
.window-titlebar-action:hover { background: var(--titlebar-hover); color: var(--titlebar-text); }
.window-titlebar-close:hover { background: #c42b1c; color: #fff; }
.window-glyph { position: relative; display: block; width: 12px; height: 12px; }
.window-glyph-minimize::before { content: ''; position: absolute; left: 1px; right: 1px; bottom: 2px; height: 1px; background: currentColor; }
.window-glyph-maximize { border: 1px solid currentColor; }
.window-glyph-restore::before { content: ''; position: absolute; top: 1px; right: 0; width: 8px; height: 8px; border: 1px solid currentColor; background: var(--titlebar-bg); }
.window-glyph-restore::after { content: ''; position: absolute; bottom: 0; left: 1px; width: 8px; height: 8px; border: 1px solid currentColor; }
.window-glyph-close::before,
.window-glyph-close::after { content: ''; position: absolute; top: 5px; left: 0; width: 13px; height: 1px; background: currentColor; }
.window-glyph-close::before { transform: rotate(45deg); }
.window-glyph-close::after { transform: rotate(-45deg); }

:global(:root.dark .window-titlebar) {
  --titlebar-bg: #181818;
  --titlebar-border: #2d2d30;
  --titlebar-text: #d4d4d4;
  --titlebar-muted: #b8b8b8;
  --titlebar-hover: #2d2d30;
  --titlebar-menu: #252526;
}

:global(:root.dark .window-titlebar-menu-popover button:hover) { background: #264f78; color: #fff; }

@media (max-width: 720px) {
  .window-titlebar-menus { display: none; }
  .window-titlebar-title { max-width: 140px; }
  .window-titlebar-action { width: 38px; }
}
</style>
