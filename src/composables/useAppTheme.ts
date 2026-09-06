import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { getPreferences, saveThemePreference } from '../api/settingsBridge'
import type { ThemePreference } from '../types/theme'

export function useAppTheme() {
  let stored: string | null = null
  try { stored = localStorage.getItem('plc-pilot-theme') } catch { /* 受限存储下仍应用当前窗口主题。 */ }
  const preference = shallowRef<ThemePreference>(stored === 'dark' || stored === 'light' ? stored : 'system')
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const systemDark = shallowRef(media.matches)
  const resolved = computed(() => preference.value === 'system' ? systemDark.value ? 'dark' : 'light' : preference.value)
  let ready = false
  const onSystemThemeChange = (event: MediaQueryListEvent) => { systemDark.value = event.matches }
  media.addEventListener('change', onSystemThemeChange)
  watch(resolved, (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.dataset.theme = theme
  }, { immediate: true })
  watch(preference, (theme) => {
    try { localStorage.setItem('plc-pilot-theme', theme) } catch { /* 本机配置仍由桌面运行时保存。 */ }
    if (ready && isTauri()) void saveThemePreference(theme).catch((error) => console.error('主题设置保存未完成', error))
  })
  onMounted(async () => {
    const initial = preference.value
    try {
      if (isTauri()) {
        const saved = await getPreferences()
        if (saved.theme && ['light', 'dark', 'system'].includes(saved.theme) && preference.value === initial) preference.value = saved.theme
      }
    } catch (error) { console.error('读取主题设置未完成', error) } finally { ready = true }
  })
  onBeforeUnmount(() => media.removeEventListener('change', onSystemThemeChange))
  return { preference, resolved }
}
