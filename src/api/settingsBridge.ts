import { invoke } from '@tauri-apps/api/core'
import type { McpSummary, SkillSummary, ToolSummary } from './plcBridge'
import type { ThemePreference } from '../types/theme'

export type McpConfig = { id: string; name: string; command: string; args: string[]; env: Record<string, string>; headers: Record<string, string>; enabled: boolean; transport: 'stdio' | 'http'; url: string | null }
export type RetrySettings = { max_retries: number; base_delay_ms: number; max_delay_ms: number }
export type ContextSettings = { auto_compact: boolean; project_memory: boolean; auto_memory: boolean }
export type Preferences = { custom_skills: Array<{ id: string; path: string }>; disabled_skills: string[]; retry: RetrySettings; theme?: ThemePreference | null; access_mode: 'approval' | 'full'; context_management: ContextSettings }
export const getPreferences = () => invoke<Preferences>('get_preferences')
export const saveThemePreference = (theme: ThemePreference) => invoke<void>('save_theme_preference', { theme })
export const saveRetrySettings = (retry: RetrySettings) => invoke<void>('save_retry_settings', { retry })
export const saveContextSettings = (contextManagement: ContextSettings) => invoke<void>('save_context_settings', { context_management: contextManagement })
export const saveAccessMode = (accessMode: Preferences['access_mode']) => invoke<void>('save_access_mode', { access_mode: accessMode })
export const getMcpConfigs = () => invoke<McpConfig[]>('get_mcp_configs')
export const saveMcpServer = (server: McpConfig) => invoke<McpSummary[]>('save_mcp_server', { server })
export const deleteMcpServer = (id: string) => invoke<void>('delete_mcp_server', { id })
export const probeMcpServer = (id: string) => invoke<ToolSummary[]>('probe_mcp_server', { id })
export const saveSkill = (path: string, id?: string) => invoke<void>('save_skill', { path, id })
export const toggleSkill = (skill: SkillSummary, enabled: boolean) => invoke<void>('toggle_skill', { id: skill.id, enabled })
export const deleteSkill = (id: string) => invoke<void>('delete_skill', { id })
export const pickSkillPath = () => invoke<string | null>('pick_skill_path')
export const listMcpCatalog = () => invoke<McpCatalogEntry[]>('list_mcp_catalog')
export const installMcpCatalog = (id: string) => invoke<McpSummary[]>('install_mcp_catalog', { id })
export const listSkillCatalog = () => invoke<SkillCatalogEntry[]>('list_skill_catalog')
export const installSkillCatalog = (id: string) => invoke<void>('install_skill_catalog', { id })

export type McpCatalogEntry = { id: string; name: string; description: string; source: string; license: string; package: string; command: string; args: string[]; transport: string; requires_workspace: boolean; requires_credentials: boolean; requires_codesys: boolean; notes: string }
export type SkillCatalogEntry = { id: string; name: string; description: string; source: string; license: string; installed: boolean; free: boolean }
