import { ref, shallowRef, watch } from 'vue'
import { getModelProviders, saveModelProvider, discoverProviderModels, importProviderModels, deleteModelProvider, setModelProviderEnabled,
  type ModelProviderSummary, type ModelDiscoveryResult, type ProviderKind } from '../api/plcBridge'

export type ProviderForm = { id: string; name: string; provider: ProviderKind; baseUrl: string; apiKey: string; enabled: boolean }
export const emptyProviderForm = (): ProviderForm => ({ id: '', name: '', provider: 'chatcompletions', baseUrl: '', apiKey: '', enabled: true })
export const providerForm = (provider: ModelProviderSummary): ProviderForm => ({ id: provider.id, name: provider.name, provider: provider.provider, baseUrl: provider.base_url, apiKey: '', enabled: provider.enabled })

/** 每次选择都清除上一服务商的发现结果；异步返回按服务商 ID 绑定，防止串厂商导入。 */
export function useModelProviders(refresh: () => void) {
  const providers = shallowRef<ModelProviderSummary[]>([])
  const form = ref<ProviderForm>(emptyProviderForm())
  const discovery = shallowRef<ModelDiscoveryResult | null>(null)
  const discoveryProviderId = shallowRef('')
  const busy = shallowRef(false)
  const loading = shallowRef(true)
  const error = shallowRef('')
  const notice = shallowRef('')
  watch(() => [form.value.baseUrl, form.value.provider, form.value.apiKey], () => { discovery.value = null; discoveryProviderId.value = '' })

  function select(provider?: ModelProviderSummary) {
    form.value = provider ? providerForm(provider) : emptyProviderForm()
    discovery.value = null; discoveryProviderId.value = ''; error.value = ''; notice.value = ''
  }
  async function reload(preferredId?: string) {
    try {
      providers.value = await getModelProviders()
      if (loading.value) select(providers.value.find(item => item.id === preferredId) ?? providers.value[0])
    } catch (cause) { error.value = String(cause) }
    finally { loading.value = false }
  }
  async function perform(action: () => Promise<void>) {
    if (busy.value) return
    busy.value = true; error.value = ''; notice.value = ''
    try { await action() } catch (cause) { error.value = String(cause) } finally { busy.value = false }
  }
  async function persistForm() {
    const saved = await saveModelProvider({ ...form.value })
    providers.value = [...providers.value.filter(item => item.id !== saved.id), saved]
    form.value = providerForm(saved)
    refresh()
    return saved
  }
  const save = () => perform(async () => { await persistForm(); notice.value = '服务商已保存，可以获取模型或手动添加模型。' })
  const discover = () => perform(async () => {
    discovery.value = null; discoveryProviderId.value = ''
    const saved = await persistForm()
    const result = await discoverProviderModels(saved.id)
    if (form.value.id === saved.id) { discovery.value = result; discoveryProviderId.value = saved.id }
  })
  const add = (ids: string[]) => perform(async () => {
    if (!discoveryProviderId.value || discoveryProviderId.value !== form.value.id) throw new Error('请重新获取当前服务商的模型。')
    const imported = await importProviderModels(discoveryProviderId.value, ids)
    notice.value = `已添加 ${imported.length} 个模型，可在对话中切换。`
    refresh()
  })
  const toggle = (provider: ModelProviderSummary, enabled: boolean) => perform(async () => {
    providers.value = await setModelProviderEnabled(provider.id, enabled)
    if (form.value.id === provider.id) form.value = { ...form.value, enabled }
    refresh()
  })
  const remove = () => perform(async () => {
    await deleteModelProvider(form.value.id)
    providers.value = providers.value.filter(item => item.id !== form.value.id)
    select(providers.value[0]); refresh()
  })
  return { providers, form, discovery, discoveryProviderId, busy, loading, error, notice, select, reload, save, discover, add, toggle, remove }
}
