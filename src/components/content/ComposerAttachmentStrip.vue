<script setup lang="ts">
import type { ComposerAttachment } from '../../composables/useComposerAttachments'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerX from '../icons/IconTablerX.vue'

defineProps<{
  attachments: readonly ComposerAttachment[]
}>()

const emit = defineEmits<{
  remove: [id: string]
}>()

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function statusLabel(attachment: ComposerAttachment): string {
  if (attachment.status === 'reading') return '正在读取'
  if (attachment.status === 'ready') return '已就绪'
  return attachment.error || '需要重新添加'
}
</script>

<template>
  <div v-if="attachments.length > 0" class="composer-attachment-strip" aria-label="待发送附件">
    <article v-for="attachment in attachments" :key="attachment.id" class="composer-attachment" :data-status="attachment.status">
      <div v-if="attachment.kind === 'image' && attachment.previewUrl" class="composer-attachment-preview">
        <img :src="attachment.previewUrl" :alt="attachment.name" />
      </div>
      <div v-else class="composer-attachment-icon" aria-hidden="true">
        <IconTablerFilePencil />
      </div>
      <div class="composer-attachment-copy">
        <strong :title="attachment.name">{{ attachment.name }}</strong>
        <span>{{ formatSize(attachment.size) }} · {{ statusLabel(attachment) }}</span>
      </div>
      <button
        type="button"
        class="composer-attachment-remove"
        :aria-label="`移除附件 ${attachment.name}`"
        :title="`移除附件 ${attachment.name}`"
        @click="emit('remove', attachment.id)"
      >
        <IconTablerX aria-hidden="true" />
      </button>
    </article>
  </div>
</template>

<style scoped>
.composer-attachment-strip {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
  padding: 10px 12px 0;
}

.composer-attachment {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: 1px solid var(--composer-border);
  border-radius: 9px;
  background: var(--composer-soft);
}

.composer-attachment[data-status='error'] {
  border-color: rgba(190, 72, 64, 0.42);
}

.composer-attachment-preview,
.composer-attachment-icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.13);
}

.composer-attachment-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.composer-attachment-icon { color: var(--composer-muted); }
.composer-attachment-icon svg { width: 17px; height: 17px; }

.composer-attachment-copy {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
}

.composer-attachment-copy strong,
.composer-attachment-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-attachment-copy strong { color: var(--composer-text); font-size: 11px; font-weight: 600; }
.composer-attachment-copy span { color: var(--composer-muted); font-size: 10px; }
.composer-attachment[data-status='error'] .composer-attachment-copy span { color: #c8645d; }

.composer-attachment-remove {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--composer-muted);
  cursor: pointer;
}

.composer-attachment-remove:hover { background: rgba(127, 127, 127, 0.16); color: var(--composer-text); }
.composer-attachment-remove svg { width: 13px; height: 13px; }
</style>
