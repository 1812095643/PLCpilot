import { invoke } from '@tauri-apps/api/core'
import type { UiAttachment } from '../types/codex'

export type DocumentKind = 'text' | 'html' | 'image' | 'docx' | 'xlsx' | 'pptx' | 'pdf'
export type DocumentNode = {
  id: string
  kind: string
  text: string
  children: DocumentNode[]
  properties: Record<string, unknown>
}
export type DocumentSnapshot = {
  id: string
  scope: string
  path: string
  name: string
  kind: DocumentKind
  version: string
  size: number
  text: string | null
  image_url: string | null
  nodes: DocumentNode[]
  warnings: string[]
  can_edit: boolean
  can_undo: boolean
  can_redo: boolean
  dirty: boolean
}
export type DocumentSelection = { documentId: string; version: string; path: string; nodeId?: string; text: string }

export const openDocument = (scope: string, input: { path?: string; attachment?: UiAttachment }) => invoke<DocumentSnapshot>('document_open', { scope, ...input })
export const closeDocument = (id: string, scope: string) => invoke<void>('document_close', { id, scope })
export const pickDocument = () => invoke<string | null>('document_pick')
export type DocumentOperation =
  | { op: 'replace_text'; target: string; before: string; after: string }
  | { op: 'set_cell'; sheet: string; address: string; value: string | number | boolean | null; formula?: string }
  | { op: 'replace_image'; target: string; path: string }
export const getDocument = (id: string, scope: string) => invoke<DocumentSnapshot>('document_get', { id, scope })
export const applyDocument = (document: DocumentSnapshot, operations: DocumentOperation[]) => invoke<DocumentSnapshot>('document_apply', { id: document.id, scope: document.scope, version: document.version, operations })
export const saveDocument = (document: DocumentSnapshot) => invoke<DocumentSnapshot>('document_save', { id: document.id, scope: document.scope, version: document.version })
export const documentHistory = (document: DocumentSnapshot, redo: boolean) => invoke<DocumentSnapshot>('document_history', { id: document.id, scope: document.scope, version: document.version, redo })
export const renderDocumentPage = (document: DocumentSnapshot, page: number) => invoke<string>('document_render_page', { id: document.id, scope: document.scope, version: document.version, page, width: 1200 })
