import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from 'vue'
import { getImageSettings, getImageStudioHistory, startImageStudioGeneration, cancelImageStudioGeneration,
  type ImageSettings, type ImageGenerationProgress } from '../api/imageGeneration'
import { getModelProviders, readLocalAttachmentFile, type ModelProviderSummary } from '../api/plcBridge'
import { openDocument, closeDocument } from '../api/documents'
import { imageParameters, validImageSize } from '../../shared/image-model-parameters.mjs'
import { useComposerAttachments } from './useComposerAttachments'

const pending = (record: ImageGenerationProgress) => record.status === 'generating' || record.status === 'partial'

/** 工作台状态独立于聊天导航；切换页面不会停止任务或丢失草稿。 */
export function useImageStudio(notice: (message: string) => void) {
  const settings = shallowRef<ImageSettings>({ models: [], default_id: '' })
  const providers = shallowRef<ModelProviderSummary[]>([])
  const records = shallowRef<ImageGenerationProgress[]>([])
  const selectedId = shallowRef('')
  const modelId = shallowRef('')
  const prompt = shallowRef('')
  const size = shallowRef('auto')
  const quality = shallowRef('auto')
  const loading = shallowRef(false)
  const submitting = shallowRef(false)
  const cancelling = shallowRef(false)
  const error = shallowRef('')
  const previewUrl = shallowRef('')
  const previewLoading = shallowRef(false)
  const attachments = useComposerAttachments({ maxFiles: 8, maxSingleBytes: 20 * 1024 * 1024, maxTotalBytes: 80 * 1024 * 1024 })
  let disposed = false
  let loadRevision = 0
  const models = computed(() => settings.value.models.filter(model => model.enabled && providers.value.some(provider => provider.id === model.provider_id && provider.enabled)))
  const selectedModel = computed(() => models.value.find(model => model.id === modelId.value) ?? null)
  const parameters = computed(() => imageParameters(selectedModel.value?.model ?? '', selectedModel.value?.parameters))
  const selected = computed(() => records.value.find(record => record.id === selectedId.value) ?? records.value[0] ?? null)
  const running = computed(() => records.value.find(record => record.scope === 'image-studio' && pending(record)) ?? null)
  const busy = computed(() => submitting.value || Boolean(running.value))
  const canSubmit = computed(() => Boolean(prompt.value.trim() && selectedModel.value && !busy.value && !attachments.isReading.value
    && !attachments.attachments.value.some(item => item.status !== 'ready') && validImageSize(size.value, parameters.value)))
  const imageUrl = computed(() => selected.value?.image_url || previewUrl.value || selected.value?.thumbnail_url || '')

  function onProgress(progress: ImageGenerationProgress) {
    const previous = records.value.find(record => record.id === progress.id)
    if (previous && !pending(previous) && pending(progress)) return
    if (previous?.status === 'partial' && progress.status === 'generating') return
    const merged = { ...previous, ...progress }
    records.value = [merged, ...records.value.filter(record => record.id !== progress.id)]
      .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? '')).slice(0, 120)
    if (!selectedId.value) selectedId.value = progress.id
    if (!pending(progress)) cancelling.value = false
  }

  async function reload() {
    const revision = ++loadRevision
    loading.value = true
    error.value = ''
    const results = await Promise.allSettled([getImageSettings(), getModelProviders(), getImageStudioHistory()] as const)
    if (disposed || revision !== loadRevision) return
    if (results[0].status === 'fulfilled') settings.value = results[0].value
    if (results[1].status === 'fulfilled') providers.value = results[1].value
    if (results[2].status === 'fulfilled') {
      const existing = records.value
      records.value = results[2].value
      // 读取磁盘期间可能已收到完成/中间图事件，实时状态不能被旧快照覆盖。
      for (const record of existing) onProgress(record)
    }
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') error.value = String(failed.reason)
    if (!models.value.some(model => model.id === modelId.value)) modelId.value = models.value.find(model => model.id === settings.value.default_id)?.id ?? models.value[0]?.id ?? ''
    if (!selectedId.value) selectedId.value = records.value[0]?.id ?? ''
    loading.value = false
  }

  watch(selectedModel, (model, previous) => {
    if (!model) return
    const caps = imageParameters(model.model, model.parameters)
    const nextSize = previous?.id === model.id ? size.value : model.size
    const nextQuality = previous?.id === model.id ? quality.value : model.quality
    size.value = validImageSize(nextSize, caps) ? nextSize : caps.sizes[0] ?? 'auto'
    quality.value = caps.qualities.includes(nextQuality) ? nextQuality : caps.qualities[0] ?? 'auto'
  })

  watch(() => selected.value?.id, async (id, _old, onCleanup) => {
    previewUrl.value = ''
    previewLoading.value = false
    let stale = false
    onCleanup(() => { stale = true })
    const record = selected.value
    // 只为当前选中的历史图片加载原图，缩略图列表不占用整批原图的内存。
    records.value = records.value.map(item => item.id !== id && !pending(item) ? { ...item, image_url: undefined } : item)
    if (!record?.path || record.image_url) return
    previewLoading.value = true
    try {
      const document = await openDocument('image-studio-preview', { path: record.path })
      if (!stale && !disposed) previewUrl.value = document.image_url ?? ''
      await closeDocument(document.id, 'image-studio-preview')
    } catch (cause) { if (!stale && !disposed) error.value = String(cause) }
    finally { if (!stale && !disposed) previewLoading.value = false }
  })

  async function attachPaths(paths: string[]) {
    const results = await Promise.allSettled(paths.map(readLocalAttachmentFile))
    if (disposed) return
    for (const result of results) {
      if (result.status === 'fulfilled' && /^image\/(?:png|jpeg|webp)$/u.test(result.value.mime_type)) attachments.addPreparedAttachment(result.value, 'drop')
      else notice(result.status === 'rejected' ? String(result.reason) : '参考图请使用 PNG、JPEG 或 WebP。')
    }
  }
  function attachFiles(files: File[]) {
    const images = files.filter(file => /^image\/(?:png|jpeg|webp)$/u.test(file.type) || /\.(?:png|jpe?g|webp)$/iu.test(file.name))
    if (images.length !== files.length) notice('参考图请使用 PNG、JPEG 或 WebP。')
    attachments.addFiles(images)
  }
  function paste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData?.files ?? [])
    if (!files.length) return
    event.preventDefault()
    attachFiles(files)
  }

  async function generate() {
    if (!canSubmit.value) return
    error.value = ''
    submitting.value = true
    try {
      const references = attachments.attachments.value.map(item => item.sourcePath).filter((path): path is string => Boolean(path))
      if (references.length !== attachments.attachments.value.length) throw new Error('参考图还没有保存到本地，请重新添加图片。')
      const progress = await startImageStudioGeneration({ prompt: prompt.value.trim(), model_id: modelId.value, size: size.value, quality: quality.value, referenced_image_paths: references })
      onProgress(progress)
      selectedId.value = progress.id
    } catch (cause) { error.value = String(cause) }
    finally { submitting.value = false }
  }
  async function cancel() {
    if (!running.value || cancelling.value) return
    cancelling.value = true
    try { await cancelImageStudioGeneration(running.value.id) }
    catch (cause) { cancelling.value = false; error.value = String(cause) }
  }
  async function reuse(record: ImageGenerationProgress) {
    prompt.value = record.prompt ?? ''
    if (models.value.some(model => model.id === record.model_id)) modelId.value = record.model_id!
    await nextTick()
    const caps = imageParameters(selectedModel.value?.model ?? '', selectedModel.value?.parameters)
    if (record.size && validImageSize(record.size, caps)) size.value = record.size
    if (record.quality && caps.qualities.includes(record.quality)) quality.value = record.quality
    attachments.clearAttachments()
    await attachPaths(record.referenced_image_paths ?? [])
  }

  onBeforeUnmount(() => { disposed = true; loadRevision++ })
  return { settings, providers, models, modelId, prompt, size, quality, parameters, records, selectedId, selected, running, busy,
    loading, submitting, cancelling, canSubmit, error, previewLoading, imageUrl, attachments, reload, onProgress, generate, cancel, reuse, attachPaths, attachFiles, paste }
}
export type ImageStudio = ReturnType<typeof useImageStudio>
