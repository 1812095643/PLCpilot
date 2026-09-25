import type { UiMessage } from '../types/codex'

/** 根据持久化轮次或相邻用户消息归组，排队输入不切断当前回复。 */
export function responseTurnKeys(messages: UiMessage[]): Map<string, string> {
  const keys = new Map<string, string>()
  let current = 'initial'
  for (const message of messages) {
    if (message.messageType === 'queued' || message.messageType === 'queued-steering') continue
    // 旧历史的正文使用 restored-*，活动使用 turn-*；相同轮次不能因此被拆开。
    const explicit = typeof message.turnIndex === 'number' ? `turn-${message.turnIndex}` : message.turnId
    if (message.role === 'user') current = explicit || `user-${message.id}`
    keys.set(message.id, explicit || current)
  }
  return keys
}

/** 所有新活动都在接收点切断正文；状态更新只原位替换，不开启新文本段。 */
export function insertTimelineActivity(
  messages: UiMessage[], activity: UiMessage, assistantId: string, bufferedText: string, createId: () => string,
): { messages: UiMessage[]; assistantId: string; split: boolean } {
  const next = [...messages]
  const existingIndex = next.findIndex((message) => message.id === activity.id)
  if (existingIndex >= 0) {
    next[existingIndex] = { ...activity, timelineOrder: next[existingIndex].timelineOrder ?? activity.timelineOrder }
    return { messages: next, assistantId, split: false }
  }
  const assistantIndex = next.findIndex((message) => message.id === assistantId)
  if (assistantIndex < 0) {
    next.push(activity)
    return { messages: next, assistantId, split: false }
  }
  const previous = { ...next[assistantIndex], text: bufferedText || next[assistantIndex].text }
  const following: UiMessage = {
    ...next[assistantIndex], id: createId(), text: '', messageType: 'agentMessage.live',
    timelineOrder: activity.timelineOrder === undefined ? undefined : activity.timelineOrder + 0.001,
  }
  // 没有正文的占位直接替换，避免连续重试/工具之间出现空行。
  const prefix = previous.text.trim() ? [previous] : []
  next.splice(assistantIndex, 1, ...prefix, activity, following)
  return { messages: next, assistantId: following.id, split: true }
}

export type CompletedResponse = {
  key: string
  startIndex: number
  header: UiMessage
  final: UiMessage
  processIds: Set<string>
}

/** 完成后折叠整轮过程，不重排或删除底层时间线；最后正式回复始终保留。 */
export function completedResponses(messages: UiMessage[], running: boolean): Map<string, CompletedResponse> {
  const keys = responseTurnKeys(messages)
  const duplicates = duplicateProgressIds(messages)
  const turns = new Map<string, { startIndex: number; items: UiMessage[] }>()
  let activeKey = ''
  messages.forEach((message, index) => {
    const key = keys.get(message.id)
    if (!key) return
    activeKey = key
    const turn = turns.get(key) ?? { startIndex: index, items: [] }
    turn.items.push(message)
    turns.set(key, turn)
  })
  const result = new Map<string, CompletedResponse>()
  for (const [key, turn] of turns) {
    if (running && key === activeKey) continue
    const final = [...turn.items].reverse().find((message) => message.role === 'assistant'
      && (message.text.trim() || message.plan?.steps.length)
      && !message.imageGeneration && !['agentMessage.commentary', 'assistant.partial', 'localCommand'].includes(message.messageType || '')
      && !(message.messageType || '').endsWith('.live'))
    if (!final || turn.items.some((message) => message.messageType === 'localCommand')) continue
    const worked = turn.items.find((message) => message.messageType === 'worked')
    const processIds = new Set(turn.items.filter((message) => message.id !== final.id && message.role !== 'user'
      && message.messageType !== 'worked' && !message.imageGeneration && !duplicates.has(message.id)
      && message.commandExecution?.status !== 'waiting'
      && (message.text.trim() || message.commandExecution || message.fileChanges?.length || message.plan?.steps.length))
      .map((message) => message.id))
    const persistedDurationMs = turn.items.find((message) => message.role === 'user')?.activityDurationMs ?? 0
    if (!worked && !processIds.size && persistedDurationMs <= 0) continue
    result.set(key, {
      key, startIndex: turn.startIndex, final, processIds,
      header: worked ?? {
        id: `process-${key}`,
        role: 'system',
        text: '操作过程',
        messageType: 'worked',
        activityDurationMs: turn.items.find((message) => message.role === 'user')?.activityDurationMs,
        turnIndex: final.turnIndex,
        turnId: final.turnId,
      },
    })
  }
  return result
}

/** 分页落到已折叠轮次中间时补回该轮标题，防止长任务的展开入口被截掉。 */
export function responseWindowStart(messages: UiMessage[], start: number, completed: Map<string, CompletedResponse>): number {
  const key = responseTurnKeys(messages).get(messages[start]?.id)
  return key ? Math.min(start, completed.get(key)?.startIndex ?? start) : start
}

export function responseTimeline(messages: UiMessage[], completed: Map<string, CompletedResponse>, start = 0): UiMessage[] {
  const keys = responseTurnKeys(messages)
  const seen = new Set<string>()
  const result: UiMessage[] = []
  for (const message of messages.slice(responseWindowStart(messages, start, completed))) {
    const group = completed.get(keys.get(message.id) || '')
    if (group && message.role !== 'user' && !seen.has(group.key)) {
      result.push(group.header)
      seen.add(group.key)
    }
    if (group && message.messageType === 'worked') continue
    result.push(message)
  }
  return result
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
      if (!group.terminal && message.messageType !== 'agentMessage.commentary' && !(message.messageType || '').endsWith('.live')) group.source = message
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
