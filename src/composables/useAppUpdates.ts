import { computed, onMounted, onUnmounted, reactive } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

type UpdatePhase = 'idle' | 'checking' | 'available' | 'current' | 'saving' | 'downloading' | 'verifying' | 'installing' | 'error'
export type AppUpdateState = {
  phase: UpdatePhase
  version: string
  portable: boolean
  autoCheck: boolean
  available: { version: string; notes: string; size: number | null } | null
  downloaded: number
  total: number | null
  error: string
  lastChecked: string
  dismissedVersion: string
  enabled: boolean
}

/** 全局仅创建一次：设置页和更新提示共享状态，切换页面不会重启下载或丢失进度。 */
export function useAppUpdates(beforeInstall: () => Promise<void>, hasRunningTasks: () => boolean) {
  const state = reactive<AppUpdateState>({ phase: 'idle', version: '', portable: false, autoCheck: true, available: null, downloaded: 0, total: null, error: '', lastChecked: '', dismissedVersion: '', enabled: isTauri() })
  const active = computed(() => ['checking', 'saving', 'downloading', 'verifying', 'installing'].includes(state.phase))
  let stopProgress: UnlistenFn | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let initialTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  async function check(): Promise<void> {
    if (!state.enabled || active.value) return
    state.phase = 'checking'; state.error = ''
    try {
      state.available = await invoke<AppUpdateState['available']>('check_app_update')
      state.lastChecked = new Date().toLocaleString('zh-CN')
      state.phase = state.available ? 'available' : 'current'
    } catch (error) {
      state.error = `暂时无法取得更新信息，请检查网络后重试。${String(error)}`
      state.phase = 'error'
    }
  }

  async function setAutoCheck(value: boolean): Promise<void> {
    try { await invoke('save_update_preferences', { autoCheck: value }); state.autoCheck = value }
    catch (error) { state.error = `更新设置未保存：${String(error)}` }
  }

  async function install(): Promise<void> {
    if (!state.available || active.value) return
    if (hasRunningTasks()) { state.error = '请等所有任务与排队消息处理完毕后再更新。'; return }
    state.phase = 'downloading'; state.error = ''
    try {
      await invoke('download_app_update', { version: state.available.version })
      state.phase = 'saving'
      // 下载可能持续数分钟；必须在下载完成之后保存最新草稿，再请求退出安装。
      await beforeInstall()
      // 保存期间可能刚好开始处理队列，退出前再检查一次；后端另有原子检查。
      if (hasRunningTasks()) throw new Error('还有任务正在处理，请结束后重试。')
      await invoke('install_app_update', { version: state.available.version })
    } catch (error) {
      state.error = String(error)
      state.phase = 'error'
    }
  }

  onMounted(async () => {
    if (!state.enabled) return
    try {
      stopProgress = await listen<{ stage: UpdatePhase; downloaded: number; total: number | null }>('app-update-progress', ({ payload }) => {
        state.phase = payload.stage; state.downloaded = payload.downloaded; state.total = payload.total
      })
      if (disposed) { stopProgress(); return }
      const preferences = await invoke<{ version: string; portable: boolean; autoCheck: boolean; lastResult: { status: string; message: string } | null }>('get_update_preferences')
      Object.assign(state, { version: preferences.version, portable: preferences.portable, autoCheck: preferences.autoCheck })
      if (preferences.lastResult?.status === 'error') state.error = preferences.lastResult.message
      if (disposed) return
      initialTimer = setTimeout(() => { if (state.autoCheck) void check() }, 5000)
      timer = setInterval(() => { if (state.autoCheck) void check() }, 24 * 60 * 60 * 1000)
    } catch (error) { state.error = `暂时无法读取更新设置：${String(error)}` }
  })
  onUnmounted(() => { disposed = true; stopProgress?.(); clearTimeout(initialTimer); clearInterval(timer) })
  return { state, active, check, install, setAutoCheck }
}
