<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import type { UiMessage } from '../../types/codex'
import SessionTimelineNode from './SessionTimelineNode.vue'

export type SessionTimelineTurn = {
  userMessage: UiMessage
  assistantMessage?: UiMessage
}

const props = defineProps<{
  turns: SessionTimelineTurn[]
}>()

const emit = defineEmits<{
  jump: [messageId: string]
}>()

const hoveredIndex = shallowRef<number | null>(null)
const timelineRef = useTemplateRef<HTMLElement>('timelineRef')
const previewTop = shallowRef(0)
const previewTurn = computed(() => hoveredIndex.value === null ? null : props.turns[hoveredIndex.value] ?? null)

function nodeLength(index: number): number {
  if (hoveredIndex.value === null) return 6
  const distance = Math.abs(index - hoveredIndex.value)
  return [24, 20, 14, 10][distance] ?? 6
}

function isNeighbor(index: number): boolean {
  return hoveredIndex.value !== null && index !== hoveredIndex.value && Math.abs(index - hoveredIndex.value) <= 3
}

function setHovered(index: number, element: HTMLElement): void {
  hoveredIndex.value = index
  const bounds = timelineRef.value?.getBoundingClientRect()
  if (!bounds) return
  const node = element.getBoundingClientRect()
  previewTop.value = Math.max(80, Math.min(bounds.height - 80, node.top + node.height / 2 - bounds.top))
}

function clearHovered(): void {
  hoveredIndex.value = null
}

function jumpToMessage(messageId: string): void {
  emit('jump', messageId)
}

function summarize(text: string, limit = 150): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (!normalized) return '（没有正文）'
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized
}
</script>

<template>
  <aside v-if="props.turns.length > 0" ref="timelineRef" class="session-timeline" aria-label="会话时间轴" @mouseleave="clearHovered" @keydown.esc="clearHovered" @focusout="clearHovered">
    <div class="session-timeline-track" @scroll="clearHovered">
      <SessionTimelineNode
        v-for="(turn, index) in props.turns"
        :key="turn.userMessage.id"
        :user-message="turn.userMessage"
        :node-length="nodeLength(index)"
        :is-hovered="hoveredIndex === index"
        :is-neighbor="isNeighbor(index)"
        @hover="setHovered(index, $event)"
        @jump="jumpToMessage"
      />
    </div>

    <Transition name="session-timeline-card">
      <section
        v-if="previewTurn"
        class="session-timeline-card"
        :style="{ top: `${previewTop}px` }"
        role="tooltip"
      >
        <div class="session-timeline-card-row">
          <span class="session-timeline-card-label">你</span>
          <p>{{ summarize(previewTurn.userMessage.text) }}</p>
        </div>
        <div v-if="previewTurn.assistantMessage?.text" class="session-timeline-card-row is-assistant">
          <span class="session-timeline-card-label">AI</span>
          <p>{{ summarize(previewTurn.assistantMessage.text) }}</p>
        </div>
      </section>
    </Transition>
  </aside>
</template>

<style scoped>
.session-timeline {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 14px;
  z-index: 40;
  display: flex;
  align-items: center;
  width: 38px;
  height: auto;
  min-height: 0;
  pointer-events: none;
}

.session-timeline-track {
  position: relative;
  display: flex;
  max-height: calc(100% - 32px);
  flex-direction: column;
  flex: 0 0 38px;
  overflow: hidden auto;
  padding: 0;
  pointer-events: auto;
  scrollbar-width: none;
}

.session-timeline-track::-webkit-scrollbar { display: none; }

.session-timeline-card {
  position: absolute;
  left: 38px;
  z-index: 3;
  display: flex;
  width: min(320px, calc(100vw - 90px));
  flex-direction: column;
  gap: 8px;
  border: 1px solid #3c3c3c;
  border-radius: 8px;
  background: #252526;
  padding: 11px 12px;
  color: #d4d4d4;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  pointer-events: auto;
  transform: translateY(-50%);
}

.session-timeline-card::before {
  position: absolute;
  top: 50%;
  left: -8px;
  width: 8px;
  height: 1px;
  background: rgba(148, 163, 184, 0.6);
  content: '';
}

.session-timeline-card-row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: start;
  gap: 7px;
}

.session-timeline-card-label {
  display: inline-flex;
  width: 22px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.08);
  color: #a3a3a3;
  font-size: 10px;
  font-weight: 700;
}

.session-timeline-card-row.is-assistant .session-timeline-card-label {
  background: rgba(255, 255, 255, 0.08);
  color: #d4d4d4;
}

.session-timeline-card-row p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: #d4d4d4;
  font-size: 12px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.session-timeline-card-enter-active,
.session-timeline-card-leave-active {
  transition: opacity 150ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.session-timeline-card-enter-from,
.session-timeline-card-leave-to {
  opacity: 0;
  transform: translate(-6px, -50%);
}

:global(:root:not(.dark) .session-timeline-card) {
  border-color: rgba(100, 116, 139, 0.18);
  background: #ffffff;
  color: #2f343b;
  box-shadow: 0 16px 34px rgba(30, 41, 59, 0.2);
}

:global(:root:not(.dark) .session-timeline-card-label) {
  background: #eef0f2;
  color: #69717d;
}

:global(:root:not(.dark) .session-timeline-card-row.is-assistant .session-timeline-card-label) {
  background: #eeeeee;
  color: #525252;
}

:global(:root:not(.dark) .session-timeline-card-row p) { color: #2f343b; }

@media (max-width: 720px) {
  .session-timeline { left: 2px; width: 36px; }
  .session-timeline-card { left: 44px; width: min(286px, calc(100vw - 58px)); }
}

@media (prefers-reduced-motion: reduce) {
  .session-timeline-card-enter-active,
  .session-timeline-card-leave-active { transition-duration: 0.01ms; }
}
</style>
