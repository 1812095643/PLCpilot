import { onMounted, readonly, shallowRef } from 'vue'
import { getPreferences, saveAccessMode, type Preferences } from '../api/settingsBridge'

type AccessMode = Preferences['access_mode']
const mode = shallowRef<AccessMode>('approval')
const ready = shallowRef(false)
const saving = shallowRef(false)
let loading: Promise<void> | undefined

/** 输入框和设置页共用磁盘设置；保存成功才更新界面，避免“显示免审批但实际没保存”。 */
export function useAccessMode(onError: (message: string) => void) {
  onMounted(() => {
    if (ready.value) return
    loading ??= getPreferences().then((preferences) => {
      mode.value = preferences.access_mode === 'full' ? 'full' : 'approval'
      ready.value = true
    }).finally(() => { loading = undefined })
    void loading.catch((error) => onError(`未能读取工具访问模式：${String(error)}`))
  })

  async function update(next: AccessMode): Promise<boolean> {
    if (!ready.value || saving.value || next === mode.value) return false
    saving.value = true
    try {
      await saveAccessMode(next)
      mode.value = next
      return true
    } catch (error) {
      onError(`工具访问模式尚未保存，请重试：${String(error)}`)
      return false
    } finally { saving.value = false }
  }

  return { mode: readonly(mode), ready: readonly(ready), saving: readonly(saving), update }
}
