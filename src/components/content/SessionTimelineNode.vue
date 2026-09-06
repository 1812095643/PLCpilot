<script setup lang="ts">
import type { UiMessage } from '../../types/codex'

const props = withDefaults(defineProps<{
  userMessage: UiMessage
  nodeLength?: number
  isHovered?: boolean
  isNeighbor?: boolean
}>(), {
  nodeLength: 6,
  isHovered: false,
  isNeighbor: false,
})

const emit = defineEmits<{
  hover: [element: HTMLElement]
  jump: [messageId: string]
}>()

function jumpToMessage(): void {
  emit('jump', props.userMessage.id)
}
</script>

<template>
  <div
    class="session-timeline-node"
    :class="{ 'is-hovered': props.isHovered, 'is-neighbor': props.isNeighbor }"
    @mouseenter="emit('hover', $event.currentTarget as HTMLElement)"
    @focusin="emit('hover', $event.currentTarget as HTMLElement)"
  >
    <button
      type="button"
      class="session-timeline-node-button"
      :style="{ '--node-scale': props.nodeLength / 6 }"
      :aria-label="`跳转到第 ${props.userMessage.turnIndex !== undefined ? props.userMessage.turnIndex + 1 : ''} 轮会话`"
      @click.stop="jumpToMessage"
    >
      <span class="session-timeline-node-mark" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.session-timeline-node {
  position: relative;
  z-index: 1;
  display: flex;
  width: 38px;
  height: 10px;
  flex: 0 0 10px;
  align-items: center;
  pointer-events: auto;
}

.session-timeline-node-button {
  display: flex;
  width: 38px;
  height: 10px;
  align-items: center;
  justify-content: flex-start;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
}

.session-timeline-node-mark {
  display: block;
  width: 6px;
  height: 2px;
  box-sizing: border-box;
  border: 1px solid var(--timeline-node, #737373);
  border-radius: 0;
  background: var(--timeline-node, #737373);
  transform-origin: left center;
  transform: scaleX(var(--node-scale));
  transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), background-color 180ms ease, border-color 180ms ease;
}

.session-timeline-node.is-hovered .session-timeline-node-mark {
  border-color: var(--timeline-active-border, #a3a3a3);
  background: var(--timeline-active, #d4d4d4);
}

.session-timeline-node.is-neighbor .session-timeline-node-mark {
  background: var(--timeline-neighbor, #a3a3a3);
  border-color: var(--timeline-neighbor, #a3a3a3);
}

.session-timeline-node-button:focus-visible {
  outline: 2px solid #007acc;
  outline-offset: 1px;
  border-radius: 2px;
}

:global(:root.dark .session-timeline-node) {
  --timeline-node: #414141;
  --timeline-neighbor: #898989;
  --timeline-active: #f0f0f0;
  --timeline-active-border: #f0f0f0;
}

@media (prefers-reduced-motion: reduce) {
  .session-timeline-node-mark { transition: none; }
}
</style>
