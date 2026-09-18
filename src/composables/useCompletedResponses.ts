import { computed, shallowRef, watch, type Ref } from 'vue'
import type { UiMessage } from '../types/codex'
import { completedResponses, responseTimeline, responseTurnKeys, responseWindowStart } from '../utils/conversationTurns'

export function useCompletedResponses(
  props: { messages: UiMessage[]; isTurnInProgress?: boolean; activeThreadId: string },
  renderWindowStart: Ref<number>,
) {
  const expanded = shallowRef(new Set<string>())
  const groups = computed(() => completedResponses(props.messages, Boolean(props.isTurnInProgress)))
  const byHeader = computed(() => new Map([...groups.value.values()].map((group) => [group.header.id, group])))
  const processIds = computed(() => new Set([...groups.value.values()].flatMap((group) => [...group.processIds])))
  const hiddenIds = computed(() => new Set([...groups.value.values()]
    .filter((group) => !expanded.value.has(group.header.id)).flatMap((group) => [...group.processIds])))
  const start = computed(() => responseWindowStart(props.messages, renderWindowStart.value, groups.value))
  const timeline = computed(() => responseTimeline(props.messages, groups.value, start.value))

  function toggle(headerId: string): void {
    const next = new Set(expanded.value)
    if (next.has(headerId)) next.delete(headerId)
    else next.add(headerId)
    expanded.value = next
  }

  function reveal(messageId: string): void {
    const key = responseTurnKeys(props.messages).get(messageId)
    const group = groups.value.get(key || '')
    if (group?.processIds.has(messageId)) expanded.value = new Set([...expanded.value, group.header.id])
  }

  watch(() => props.activeThreadId, () => { expanded.value = new Set() })
  watch(groups, () => {
    const next = [...expanded.value].filter((id) => byHeader.value.has(id))
    if (next.length !== expanded.value.size) expanded.value = new Set(next)
  })

  return { groups, byHeader, processIds, hiddenIds, timeline, start, expanded, toggle, reveal }
}
