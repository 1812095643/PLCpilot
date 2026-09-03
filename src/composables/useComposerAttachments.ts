import { computed, onBeforeUnmount, readonly, shallowRef } from 'vue'
import type { UiAttachment, UiAttachmentKind, UiAttachmentStatus } from '../types/codex'

export type ComposerAttachmentSource = 'file' | 'clipboard' | 'drop' | 'draft'

export type ComposerAttachment = UiAttachment & {
  status: UiAttachmentStatus
  error?: string
  dataBase64?: string
  textContent?: string
  source?: ComposerAttachmentSource
}

export type ComposerAttachmentDraft = Pick<ComposerAttachment, 'id' | 'name' | 'mimeType' | 'size' | 'kind' | 'status' | 'error' | 'dataBase64' | 'textContent'>

export type PreparedComposerAttachment = {
  id?: string
  name: string
  mime_type: string
  size: number
  kind: UiAttachmentKind | string
  data_base64?: string
  image_url?: string
  text_content?: string
  error?: string
}

type AttachmentOptions = {
  maxFiles?: number
  maxSingleBytes?: number
  maxTotalBytes?: number
  maxTextBytes?: number
}

const DEFAULT_OPTIONS: Required<AttachmentOptions> = {
  maxFiles: 12,
  maxSingleBytes: 8 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024,
  maxTextBytes: 512 * 1024,
}

const TEXT_EXTENSIONS = new Set([
  'c', 'cc', 'cpp', 'css', 'csv', 'h', 'hpp', 'html', 'ini', 'iecst', 'java', 'js', 'json',
  'log', 'md', 'mjs', 'py', 'rs', 'sql', 'st', 'svg', 'toml', 'ts', 'tsx', 'txt', 'vue', 'xml',
  'yaml', 'yml',
])

function createId(): string {
  return `attachment-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index + 1).toLowerCase() : ''
}

function isTextFile(file: File): boolean {
  return file.type.startsWith('text/')
    || ['application/json', 'application/javascript', 'application/xml', 'image/svg+xml'].includes(file.type)
    || TEXT_EXTENSIONS.has(extensionOf(file.name))
}

function imageMimeType(file: File): string | null {
  if (file.type.startsWith('image/')) return file.type
  const extension = extensionOf(file.name)
  const byExtension: Record<string, string> = {
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  }
  return byExtension[extension] || null
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function base64ToDataUrl(mimeType: string, dataBase64: string): string {
  return `data:${mimeType};base64,${dataBase64}`
}

function revokePreview(attachment: ComposerAttachment): void {
  if (attachment.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(attachment.previewUrl)
}

function readFileAsBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => bytesToBase64(new Uint8Array(buffer)))
}

async function readTextFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  return new TextDecoder('utf-8').decode(bytes)
}

export function useComposerAttachments(options: AttachmentOptions = {}) {
  const limits = { ...DEFAULT_OPTIONS, ...options }
  const source = shallowRef<ComposerAttachment[]>([])
  const isReading = computed(() => source.value.some((attachment) => attachment.status === 'reading'))
  const hasReadyAttachment = computed(() => source.value.some((attachment) => attachment.status === 'ready'))

  function updateAttachment(id: string, update: Partial<ComposerAttachment>): void {
    source.value = source.value.map((attachment) => attachment.id === id
      ? { ...attachment, ...update }
      : attachment)
  }

  function pushUnsupported(file: File, sourceType: ComposerAttachmentSource, error: string): ComposerAttachment {
    return {
      id: createId(),
      name: file.name || '未命名文件',
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      kind: 'file',
      status: 'error',
      error,
      source: sourceType,
    }
  }

  async function prepareFile(file: File, sourceType: ComposerAttachmentSource, id: string): Promise<void> {
    const mimeType = file.type || (isTextFile(file) ? 'text/plain' : 'application/octet-stream')
    const kind: UiAttachmentKind = mimeType.startsWith('image/')
      ? 'image'
      : isTextFile(file) ? 'text' : 'file'
    try {
      if (kind === 'text') {
        if (file.size > limits.maxTextBytes) {
          updateAttachment(id, {
            status: 'error',
            error: `文本文件超过 ${Math.round(limits.maxTextBytes / 1024)} KB 读取上限。`,
          })
          return
        }
        const textContent = await readTextFile(file)
        updateAttachment(id, { status: 'ready', textContent, mimeType })
        return
      }
      const dataBase64 = await readFileAsBase64(file)
      updateAttachment(id, {
        status: 'ready',
        mimeType,
        dataBase64,
        previewUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
      })
    } catch (error) {
      updateAttachment(id, {
        status: 'error',
        error: error instanceof Error ? `读取附件未完成：${error.message}` : '读取附件未完成。',
      })
    }
  }

  function addFiles(files: File[], sourceType: ComposerAttachmentSource = 'file'): void {
    const candidates = files.filter((file) => typeof File === 'undefined' || file instanceof File)
    if (candidates.length === 0) return
    const existingFingerprints = new Set(source.value.map((attachment) => `${attachment.name}\u0000${attachment.size}\u0000${attachment.mimeType}`))
    const reservedBytes = source.value.reduce((total, attachment) => total + attachment.size, 0)
    let totalBytes = reservedBytes
    const next: Array<{ file: File; attachment: ComposerAttachment }> = []
    for (const file of candidates) {
      const duplicateKey = `${file.name}\u0000${file.size}\u0000${file.type}`
      if (existingFingerprints.has(duplicateKey) || next.some((attachment) => attachment.name === file.name && attachment.size === file.size && attachment.mimeType === file.type)) continue
      if (source.value.length + next.length >= limits.maxFiles) break
      if (file.size > limits.maxSingleBytes) {
        next.push({
          file,
          attachment: pushUnsupported(file, sourceType, `文件超过 ${Math.round(limits.maxSingleBytes / 1024 / 1024)} MB 单文件上限。`),
        })
        continue
      }
      if (totalBytes + file.size > limits.maxTotalBytes) {
        next.push({
          file,
          attachment: pushUnsupported(file, sourceType, `附件总大小不能超过 ${Math.round(limits.maxTotalBytes / 1024 / 1024)} MB。`),
        })
        continue
      }
      existingFingerprints.add(duplicateKey)
      totalBytes += file.size
      const mimeType = file.type || (isTextFile(file) ? 'text/plain' : imageMimeType(file) || 'application/octet-stream')
      const kind: UiAttachmentKind = mimeType.startsWith('image/')
        ? 'image'
        : isTextFile(file) ? 'text' : 'file'
      next.push({
        file,
        attachment: {
          id: createId(),
          name: file.name || '未命名文件',
          mimeType,
          size: file.size,
          kind,
          status: 'reading',
          source: sourceType,
        },
      })
    }
    if (next.length > 0) {
      source.value = [...source.value, ...next.map((item) => item.attachment)]
      next.forEach(({ file, attachment }) => {
        if (attachment.status === 'reading') void prepareFile(file, sourceType, attachment.id)
      })
    }
  }

  function removeAttachment(id: string): void {
    const attachment = source.value.find((item) => item.id === id)
    if (attachment) revokePreview(attachment)
    source.value = source.value.filter((item) => item.id !== id)
  }

  function addPreparedAttachment(input: PreparedComposerAttachment, sourceType: ComposerAttachmentSource = 'clipboard'): void {
    const mimeType = String(input.mime_type || 'application/octet-stream')
    const kind = input.kind === 'image' || input.kind === 'text' ? input.kind : 'file'
    const duplicate = source.value.some((attachment) => attachment.name === input.name && attachment.size === input.size && attachment.mimeType === mimeType)
    if (duplicate || source.value.length >= limits.maxFiles) return
    if (input.size > limits.maxSingleBytes || source.value.reduce((total, attachment) => total + attachment.size, 0) + input.size > limits.maxTotalBytes) {
      source.value = [...source.value, {
        id: input.id || createId(),
        name: input.name || '未命名文件',
        mimeType,
        size: input.size,
        kind,
        status: 'error',
        error: input.size > limits.maxSingleBytes
          ? `文件超过 ${Math.round(limits.maxSingleBytes / 1024 / 1024)} MB 单文件上限。`
          : `附件总大小不能超过 ${Math.round(limits.maxTotalBytes / 1024 / 1024)} MB。`,
        source: sourceType,
      }]
      return
    }
    const dataBase64 = input.data_base64 || (input.image_url?.split(',', 2)[1] ?? '') || undefined
    source.value = [...source.value, {
      id: input.id || createId(),
      name: input.name || '未命名文件',
      mimeType,
      size: input.size,
      kind,
      status: input.error ? 'error' : 'ready',
      error: input.error,
      dataBase64,
      textContent: input.text_content,
      previewUrl: kind === 'image' && (input.image_url || dataBase64)
        ? input.image_url || `data:${mimeType};base64,${dataBase64}`
        : undefined,
      source: sourceType,
    }]
  }

  function clearAttachments(): void {
    source.value.forEach(revokePreview)
    source.value = []
  }

  function serializeAttachments(): ComposerAttachmentDraft[] {
    return source.value.map(({ previewUrl: _previewUrl, source: _source, ...attachment }) => attachment)
  }

  function restoreAttachments(items: ComposerAttachmentDraft[] | undefined): void {
    clearAttachments()
    if (!Array.isArray(items)) return
    source.value = items
      .filter((item): item is ComposerAttachmentDraft => Boolean(item)
        && typeof item.id === 'string'
        && typeof item.name === 'string'
        && typeof item.mimeType === 'string'
        && typeof item.size === 'number'
        && ['image', 'text', 'file'].includes(item.kind)
        && ['reading', 'ready', 'error'].includes(item.status))
      .slice(0, limits.maxFiles)
      .map((item) => ({
        ...item,
        status: item.status === 'reading' ? 'error' : item.status,
        error: item.status === 'reading' ? '草稿恢复后需要重新读取此附件。' : item.error,
        previewUrl: item.kind === 'image' && item.dataBase64
          ? base64ToDataUrl(item.mimeType, item.dataBase64)
          : undefined,
        source: 'draft' as const,
      }))
  }

  onBeforeUnmount(clearAttachments)

  return {
    attachments: readonly(source),
    isReading,
    hasReadyAttachment,
    addFiles,
    addPreparedAttachment,
    removeAttachment,
    clearAttachments,
    serializeAttachments,
    restoreAttachments,
  }
}
