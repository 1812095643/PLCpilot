import type { UiMessage } from '../types/codex'

/** 根据持久化轮次或相邻用户消息归组，排队输入不切断当前回复。 */
export function responseTurnKeys(messages: UiMessage[]): Map<string, string> {
  const keys = new Map<string, string>()
  let current = 'initial'
  for (const message of messages) {
    if (message.messageType === 'queued' || message.messageType === 'queued-steering') continue
    if (message.role === 'user') current = message.turnId || (typeof message.turnIndex === 'number' ? `turn-${message.turnIndex}` : `user-${message.id}`)
    keys.set(message.id, message.turnId || (typeof message.turnIndex === 'number' ? `turn-${message.turnIndex}` : current))
  }
  return keys
}

/** 最终结果只是流式正文的回执。只有确实未显示过时，才允许填补空的尾段。 */
export function hasTurnResponseText(messages: UiMessage[], turnIndex: number, text: string): boolean {
  const expected = text.trim()
  if (!expected) return true
  const parts = messages.filter((message) => message.role === 'assistant' && message.turnIndex === turnIndex && message.text.trim())
  return parts.some((message) => message.text.trim() === expected)
}

/** 兼容旧会话中与 assistant 原文完全相同的 progress 镜像，仅隐藏镜像，不删除记录。 */
export function duplicateProgressIds(messages: UiMessage[]): Set<string> {
  const keys = responseTurnKeys(messages)
  const originals = new Set(messages.filter((message) => message.role === 'assistant' && message.messageType !== 'agentMessage.commentary')
    .map((message) => `${keys.get(message.id)}\n${message.text.trim()}`))
  return new Set(messages.filter((message) => message.messageType === 'agentMessage.commentary'
    && originals.has(`${keys.get(message.id)}\n${message.text.trim()}`)).map((message) => message.id))
}

/**
 * 为完整回复选择页脚位置。正文段只决定复制内容/Fork 来源，位置取该轮最后一个
 * 可见记录（包括最后的工具、命令、审批结果）。这样工具追加后页脚不会夹在中间。
 * 当前运行轮隐藏页脚，历史已完成轮保持可用；错误/中止保留各自的重试与复制入口。
 */
export function responseFooterAnchors(messages: UiMessage[], visibleIds: Set<string>, running: boolean): Map<string, UiMessage> {
  const keys = responseTurnKeys(messages)
  const duplicates = duplicateProgressIds(messages)
  const groups = new Map<string, { tail: string; source?: UiMessage; terminal: boolean }>()
  let activeKey = ''
  for (const message of messages) {
    const key = keys.get(message.id)
    if (!key) continue
    activeKey = key
    const group = groups.get(key) ?? { tail: '', terminal: false }
    if (visibleIds.has(message.id)) group.tail = message.id
    if (!duplicates.has(message.id) && message.role === 'assistant' && (message.text.trim() || message.plan?.steps.length)) {
      group.terminal = ['turnError', 'turnInterrupted', 'localCommand'].includes(message.messageType || '')
      if (!group.terminal && !(message.messageType || '').endsWith('.live')) group.source = message
    }
    groups.set(key, group)
  }
  const result = new Map<string, UiMessage>()
  for (const [key, group] of groups) {
    if (!group.tail || !group.source || group.terminal || (running && key === activeKey)) continue
    result.set(group.tail, group.source)
  }
  return result
}
