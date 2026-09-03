import type { CommandSummary } from '../api/plcBridge'

export type SlashCommandPopupState = {
  /** 当前完整命令 token，用于复刻 Codex 的 Escape 关闭记忆。 */
  token: string
  /** 光标前的命令前缀，带 `/`，用于实时筛选。 */
  query: string
}

function firstLineOf(text: string): string {
  const lineEnd = text.indexOf('\n')
  return lineEnd === -1 ? text : text.slice(0, lineEnd)
}

function commandText(command: CommandSummary): string {
  const value = command.command.trim()
  return value.startsWith('/') ? value : `/${value}`
}

function commandTokenEnd(firstLine: string): number {
  const whitespaceOffset = firstLine.slice(1).search(/\s/u)
  return whitespaceOffset === -1 ? firstLine.length : whitespaceOffset + 1
}

function commandName(command: CommandSummary): string {
  return commandText(command).slice(1).toLowerCase()
}

/**
 * 按 Codex `CommandPopup::filtered` 的顺序筛选命令：精确匹配排在前面，
 * 前缀匹配保留运行时注册表原有顺序。
 */
export function filterSlashCommands(commands: CommandSummary[], query: string): CommandSummary[] {
  const firstLine = firstLineOf(query)
  const filter = firstLine.startsWith('/')
    ? firstLine.slice(1).trimStart().split(/\s+/u, 1)[0]?.toLowerCase() ?? ''
    : ''
  if (!filter) return commands

  const exact: CommandSummary[] = []
  const prefix: CommandSummary[] = []
  for (const command of commands) {
    const name = commandName(command)
    if (name === filter) exact.push(command)
    else if (name.startsWith(filter)) prefix.push(command)
  }
  return [...exact, ...prefix]
}

/**
 * 返回首行完整命令 token。该值与 Codex 在 Escape 后保存的 token 一致，
 * 因此只要用户未修改命令名，弹窗就不会被立即重新打开。
 */
export function getSlashCommandToken(text: string): string | null {
  const firstLine = firstLineOf(text)
  if (!firstLine.startsWith('/')) return null
  return firstLine.slice(0, commandTokenEnd(firstLine))
}

/**
 * 将 Codex `command_under_cursor` 与 `is_editing_command_name` 的规则映射到浏览器 textarea：
 * 只有光标位于首行起始 `/命令` token 内，且前缀存在于真实命令注册表时才显示弹窗。
 */
export function getSlashCommandPopupState(
  text: string,
  cursor: number,
  commands: CommandSummary[],
): SlashCommandPopupState | null {
  const firstLine = firstLineOf(text)
  const safeCursor = Math.max(0, Math.min(cursor, text.length))
  if (!firstLine.startsWith('/') || safeCursor > firstLine.length) return null

  const tokenEnd = commandTokenEnd(firstLine)
  const fullName = firstLine.slice(1, tokenEnd)
  if (fullName.includes('/')) return null

  // Codex 将光标位于 `/` 左侧或紧随 `/` 的情况视为正在编辑完整 token。
  const effectiveCursor = safeCursor <= 1 ? tokenEnd : safeCursor
  if (effectiveCursor > tokenEnd) return null

  const prefix = firstLine.slice(1, effectiveCursor)
  const rest = firstLine.slice(effectiveCursor)
  if (!prefix) {
    if (rest.length > 0) return null
  } else if (!commands.some((command) => commandName(command).startsWith(prefix.toLowerCase()))) {
    return null
  }

  return {
    token: `/${fullName}`,
    query: `/${prefix}`,
  }
}

/**
 * 对支持参数的命令保留光标后的草稿尾部。该行为逐字对应 Codex
 * `complete_selected_slash_command_preserving_existing_draft_tail_as_inline_args`。
 */
export function completeSlashCommandPreservingDraftTail(
  text: string,
  cursor: number,
  command: CommandSummary,
): string | null {
  if (!command.supports_args || !text.startsWith('/')) return null

  const lineEnd = text.indexOf('\n')
  const firstLineEnd = lineEnd === -1 ? text.length : lineEnd
  if (cursor > firstLineEnd) return null

  const firstLine = text.slice(0, firstLineEnd)
  const tokenEnd = commandTokenEnd(firstLine)
  const typedName = text.slice(1, tokenEnd)
  const remainingTextIsEmpty = text.slice(tokenEnd).trim().length === 0
  if (remainingTextIsEmpty && (cursor <= 1 || cursor >= tokenEnd)) return null

  const selectedText = commandText(command)
  const replaceEnd = cursor <= 1 || (typedName === selectedText.slice(1) && remainingTextIsEmpty)
    ? tokenEnd
    : cursor
  const tail = text.slice(replaceEnd)
  const replacement = /^\s/u.test(tail) ? selectedText : `${selectedText} `
  return `${replacement}${tail}`
}

/**
 * 完成不保留草稿尾部的普通命令；与 Codex `selected_command_completion` 一样，
 * 补全结果仅保留命令与一个参数空格。
 */
export function completeSlashCommand(firstLine: string, command: CommandSummary): string | null {
  const selectedText = commandText(command)
  return firstLine.trimStart().startsWith(selectedText) ? null : `${selectedText} `
}
