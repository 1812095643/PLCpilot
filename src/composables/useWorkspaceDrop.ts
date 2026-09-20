import { onBeforeUnmount, shallowRef } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { inspectDroppedPaths } from '../api/plcBridge'

type WorkspaceDropOptions = {
  openProject: (path: string) => Promise<void>
  attachPaths: (paths: string[]) => Promise<void>
  attachFiles: (files: File[]) => Promise<void>
  notice: (message: string) => void
}

function localUriPaths(value: string): string[] {
  return value.split(/\r?\n/u).flatMap((line) => {
    try {
      const url = new URL(line.trim())
      if (url.protocol !== 'file:') return []
      const path = decodeURIComponent(url.pathname).replace(/^\/(?=[A-Z]:[\\/])/iu, '')
      return [url.hostname && url.hostname !== 'localhost' ? '//'+url.hostname+path : path]
    } catch { return [] }
  })
}

/** 原生窗口与输入框共用一条拖拽管线；目录类型以磁盘属性为准，单文件不会成为项目。 */
export function useWorkspaceDrop(options: WorkspaceDropOptions) {
  const active = shallowRef(false)
  let stopNativeDrop: (() => void) | undefined
  let disposed = false
  let pendingDrop = Promise.resolve()

  function enqueue(action: () => Promise<void>): Promise<void> {
    active.value = false
    pendingDrop = pendingDrop.then(action).catch((error) => options.notice(String(error)))
    return pendingDrop
  }

  async function acceptPaths(paths: string[]): Promise<void> {
    const entries = await inspectDroppedPaths([...new Set(paths)])
    for (const entry of entries) {
      if (entry.kind === 'directory') await options.openProject(entry.path)
    }
    const files = entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path)
    if (files.length) await options.attachPaths(files)
    if (entries.some((entry) => entry.kind === 'unknown')) {
      options.notice('部分拖入的路径无法读取，请检查文件是否已移动或被删除。')
    }
  }

  function hasFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).some((type) => type === 'Files' || type === 'text/uri-list')
  }

  function onDragOver(event: DragEvent): void {
    if (!hasFiles(event)) return
    event.preventDefault()
    if (!stopNativeDrop) active.value = true
  }

  function onDragLeave(event: DragEvent): void {
    if (event.relatedTarget instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    active.value = false
  }

  function onDrop(event: DragEvent): void {
    if (!hasFiles(event)) return
    event.preventDefault()
    active.value = false
    // Tauri 接管系统拖拽时只消费原生事件，避免同一次拖入被 DOM 再处理一次。
    if (stopNativeDrop) return
    const paths = localUriPaths(event.dataTransfer?.getData('text/uri-list') ?? '')
    if (isTauri() && paths.length) {
      void enqueue(() => acceptPaths(paths))
      return
    }
    const items = Array.from(event.dataTransfer?.items ?? []).filter((item) => item.kind === 'file')
    const files = items.length
      ? items.filter((item) => !item.webkitGetAsEntry?.()?.isDirectory).map((item) => item.getAsFile()).filter((file): file is File => file !== null)
      : Array.from(event.dataTransfer?.files ?? [])
    if (items.some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
      options.notice('请在桌面程序中拖入文件夹，或使用“添加项目”选择目录。')
    }
    if (files.length) void enqueue(() => options.attachFiles(files))
  }

  async function setupNativeDrop(): Promise<void> {
    if (!isTauri()) return
    try {
      const stop = await getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (payload.type === 'enter' || payload.type === 'over') active.value = true
        else if (payload.type === 'leave') active.value = false
        else if (payload.type === 'drop') void enqueue(() => acceptPaths(payload.paths))
      })
      if (disposed) stop()
      else stopNativeDrop = stop
    } catch (error) {
      options.notice('窗口拖拽尚未就绪，请重新打开软件后再试：' + String(error))
    }
  }

  onBeforeUnmount(() => { disposed = true; stopNativeDrop?.() })
  return { active, onDragOver, onDragLeave, onDrop, setupNativeDrop }
}
