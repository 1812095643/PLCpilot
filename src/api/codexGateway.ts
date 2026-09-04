import { invoke } from '@tauri-apps/api/core'

import type { ComposerMentionSuggestion } from './plcBridge'

export type ComposerFileSuggestion = { path: string }

type RollbackResult = {
  changed: number
  errors: string[]
  message?: string
  revertedPatchIds?: string[]
  appliedPatchIds?: string[]
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error('当前页面未连接 PLC Pilot 桌面运行时')
  }
  return invoke<T>(command, args)
}

/**
 * Composer 使用的工程文件搜索。搜索结果来自 Rust 扫描快照，不读取浏览器或远程目录。
 */
export async function searchComposerFiles(cwd: string, query: string, limit = 20): Promise<ComposerFileSuggestion[]> {
  try {
    return await call<ComposerFileSuggestion[]>('search_project_files', {
      cwd,
      query,
      limit,
    })
  } catch {
    return []
  }
}

export async function searchComposerMentions(cwd: string, query: string, limit = 24): Promise<ComposerMentionSuggestion[]> {
  try {
    return await call<ComposerMentionSuggestion[]>('search_composer_mentions', {
      cwd,
      query,
      limit,
    })
  } catch {
    return []
  }
}

export async function updateThreadFileChanges(
  threadId: string,
  turnId: string,
  cwd: string,
  action: 'undo' | 'redo',
  patchIds?: string[],
  scope?: 'single_turn' | 'turn_and_later',
): Promise<RollbackResult> {
  try {
    return await call<RollbackResult>('update_thread_file_changes', {
      threadId,
      turnId,
      cwd,
      action,
      patchIds,
      scope,
    })
  } catch (error) {
    return {
      changed: 0,
      errors: [error instanceof Error ? error.message : '工程修改回滚未完成'],
    }
  }
}
