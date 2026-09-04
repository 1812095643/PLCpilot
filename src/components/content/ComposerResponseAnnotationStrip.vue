<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { UiResponseTextAnnotation } from '../../types/codex'
import IconTablerEdit from '../icons/IconTablerEdit.vue'
import IconTablerMessageCircle from '../icons/IconTablerMessageCircle.vue'
import IconTablerTrash from '../icons/IconTablerTrash.vue'
import IconTablerX from '../icons/IconTablerX.vue'

const props = defineProps<{
  annotations: readonly UiResponseTextAnnotation[]
}>()

const emit = defineEmits<{
  remove: [id: string]
  edit: [annotation: UiResponseTextAnnotation]
}>()

const isOpen = shallowRef(false)
const summaryLabel = computed(() => `${props.annotations.length} 条`)

function close(): void {
  isOpen.value = false
}
</script>

<template>
  <div v-if="annotations.length > 0" class="composer-response-annotations">
    <button
      type="button"
      class="composer-response-annotation-pill"
      :aria-expanded="isOpen"
      aria-label="查看回复批注"
      title="查看回复批注"
      @click="isOpen = !isOpen"
    >
      <IconTablerMessageCircle aria-hidden="true" />
      <span>{{ summaryLabel }}</span>
    </button>

    <section v-if="isOpen" class="composer-response-annotation-popover" aria-label="待发送回复批注">
      <header class="composer-response-annotation-header">
        <span>回复批注</span>
        <button type="button" aria-label="关闭批注详情" title="关闭" @click="close">
          <IconTablerX aria-hidden="true" />
        </button>
      </header>
      <ol class="composer-response-annotation-list">
        <li v-for="(annotation, index) in annotations" :key="annotation.id" class="composer-response-annotation-item">
          <span class="composer-response-annotation-number">{{ index + 1 }}.</span>
          <div class="composer-response-annotation-copy">
            <span class="composer-response-annotation-label">所选文本：</span>
            <p>{{ annotation.selectedText }}</p>
            <span class="composer-response-annotation-label">用户评论：</span>
            <p>{{ annotation.body }}</p>
          </div>
          <div class="composer-response-annotation-actions">
            <button type="button" :aria-label="`编辑批注 ${index + 1}`" :title="`编辑批注 ${index + 1}`" @click="emit('edit', annotation)">
              <IconTablerEdit aria-hidden="true" />
            </button>
            <button type="button" :aria-label="`移除批注 ${index + 1}`" :title="`移除批注 ${index + 1}`" @click="emit('remove', annotation.id)">
              <IconTablerTrash aria-hidden="true" />
            </button>
          </div>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.composer-response-annotations {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.composer-response-annotation-pill {
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  gap: 5px;
  border: 1px solid color-mix(in srgb, var(--composer-muted) 28%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--composer-soft) 88%, transparent);
  padding: 3px 9px 3px 7px;
  color: var(--composer-muted);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease;
}

.composer-response-annotation-pill:hover,
.composer-response-annotation-pill[aria-expanded='true'] {
  border-color: rgba(59, 130, 246, 0.58);
  background: rgba(59, 130, 246, 0.12);
  color: #60a5fa;
}

.composer-response-annotation-pill :deep(svg) {
  width: 14px;
  height: 14px;
}

.composer-response-annotation-popover {
  position: absolute;
  right: 0;
  bottom: calc(100% + 9px);
  z-index: 30;
  width: min(360px, calc(100vw - 32px));
  max-height: min(360px, 60vh);
  overflow: auto;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  background: #1e232b;
  color: #e5e7eb;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(0, 0, 0, 0.12);
}

.composer-response-annotation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  padding: 9px 11px;
  color: #f3f4f6;
  font-size: 11px;
  font-weight: 700;
}

.composer-response-annotation-header button,
.composer-response-annotation-actions button {
  display: inline-grid;
  width: 23px;
  height: 23px;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
}

.composer-response-annotation-header button:hover,
.composer-response-annotation-actions button:hover {
  background: rgba(148, 163, 184, 0.14);
  color: #f3f4f6;
}

.composer-response-annotation-header :deep(svg),
.composer-response-annotation-actions :deep(svg) {
  width: 14px;
  height: 14px;
}

.composer-response-annotation-list {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.composer-response-annotation-item {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 11px;
}

.composer-response-annotation-item + .composer-response-annotation-item {
  border-top: 1px solid rgba(148, 163, 184, 0.12);
}

.composer-response-annotation-number {
  flex: 0 0 auto;
  color: #9ca3af;
  font-size: 12px;
  line-height: 18px;
}

.composer-response-annotation-copy {
  min-width: 0;
  flex: 1 1 auto;
  font-size: 11px;
  line-height: 1.45;
}

.composer-response-annotation-label {
  display: block;
  color: #9ca3af;
  font-size: 10px;
  font-weight: 600;
}

.composer-response-annotation-copy p {
  margin: 2px 0 7px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  color: #e5e7eb;
}

.composer-response-annotation-copy p:last-child {
  margin-bottom: 0;
}

.composer-response-annotation-actions {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 2px;
}
</style>
