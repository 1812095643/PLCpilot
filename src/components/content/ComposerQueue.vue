<script setup lang="ts">
import IconTablerX from '../icons/IconTablerX.vue'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
const props = defineProps<{ items: Array<{ id: string; payload: { text: string; attachments?: unknown[] } }>; paused: boolean }>()
const emit = defineEmits<{ cancel: [id: string]; resume: [] }>()
</script>

<template>
  <section class="composer-queue" aria-label="待发送队列">
    <header><span>{{ paused ? '队列已暂停' : '等待发送' }} · {{ items.length }}</span><button v-if="paused" type="button" title="继续队列" aria-label="继续队列" @click="emit('resume')"><IconTablerArrowUp /></button></header>
    <ol><li v-for="(item, index) in props.items" :key="item.id"><span class="queue-index">{{ index + 1 }}</span><p :title="item.payload.text">{{ item.payload.text || `${item.payload.attachments?.length || 0} 个附件` }}</p><button type="button" :title="`取消第 ${index + 1} 条排队消息`" :aria-label="`取消第 ${index + 1} 条排队消息`" @click="emit('cancel', item.id)"><IconTablerX /></button></li></ol>
  </section>
</template>

<style scoped>
.composer-queue { width: 100%; max-height: 144px; overflow-y: auto; padding: 4px 12px; color: var(--plc-text, #333); font-size: 12px; }
header, li { display: flex; align-items: center; gap: 8px; min-height: 26px; }
header { justify-content: space-between; color: #737373; }
ol { margin: 0; padding: 0; list-style: none; }
li p { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; }
.queue-index { color: #8c8c8c; font-variant-numeric: tabular-nums; width: 14px; }
button { display: grid; place-items: center; width: 24px; height: 24px; border: 0; border-radius: 4px; color: inherit; background: transparent; cursor: pointer; }
button:hover { background: rgba(128, 128, 128, .15); }
button svg { width: 14px; height: 14px; }
:global(.dark .composer-queue) { color: #d4d4d4; }
</style>
