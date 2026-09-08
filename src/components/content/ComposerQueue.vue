<script setup lang="ts">
import { shallowRef } from 'vue'
import { IconGripVertical, IconEdit, IconBolt, IconX, IconArrowUp } from '@tabler/icons-vue'
const props = defineProps<{ items: Array<{ id: string; payload: { text: string; attachments?: unknown[] }; steering?: boolean }>; paused: boolean; busy: boolean }>()
const emit = defineEmits<{ cancel: [id: string]; resume: []; edit: [id: string]; steer: [id: string]; reorder: [id: string, targetId: string] }>()
const dragged = shallowRef('')
const over = shallowRef('')
function startDrag(event: DragEvent, id: string): void {
  dragged.value = id
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/x-plc-queue', id) }
}
function finishDrag(): void { dragged.value = ''; over.value = '' }
function drop(targetId: string): void {
  if (dragged.value && dragged.value !== targetId) emit('reorder', dragged.value, targetId)
  finishDrag()
}
</script>

<template>
  <section class="composer-queue" aria-label="待发送队列" @dragover.prevent.stop @drop.prevent.stop>
    <header><span>{{ paused ? '队列已暂停' : '等待发送' }} · {{ items.length }}</span><button v-if="paused" type="button" title="继续队列" aria-label="继续队列" @click="emit('resume')"><IconArrowUp /></button></header>
    <ol>
      <li v-for="(item, index) in props.items" :key="item.id" :class="{ dragging: dragged === item.id, target: over === item.id }" :draggable="!item.steering" @dragstart.stop="startDrag($event, item.id)" @dragend="finishDrag" @dragenter.prevent="over = item.id" @drop.prevent.stop="drop(item.id)">
        <button class="queue-grip" type="button" :disabled="item.steering" :aria-label="`拖动第 ${index + 1} 条消息排序，也可使用 Alt 加方向键`" @keydown.alt.up.prevent="index > 0 && emit('reorder', item.id, items[index - 1].id)" @keydown.alt.down.prevent="index < items.length - 1 && emit('reorder', item.id, items[index + 1].id)"><IconGripVertical /></button>
        <p :title="item.payload.text">{{ item.payload.text || `${item.payload.attachments?.length || 0} 个附件` }}</p>
        <span v-if="item.steering" class="queue-steering">等待采用新方向</span>
        <template v-else>
          <button type="button" title="撤回到输入框编辑" :aria-label="`编辑第 ${index + 1} 条排队消息`" @click="emit('edit', item.id)"><IconEdit /></button>
          <button type="button" :title="busy ? '立即调整方向，不中断当前操作' : '立即发送'" :aria-label="`立即调整第 ${index + 1} 条消息`" @click="emit('steer', item.id)"><IconBolt /></button>
          <button type="button" :title="`取消第 ${index + 1} 条排队消息`" :aria-label="`取消第 ${index + 1} 条排队消息`" @click="emit('cancel', item.id)"><IconX /></button>
        </template>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.composer-queue { width:100%; max-height:156px; overflow-y:auto; padding:4px 12px; color:var(--plc-text,#333); font-size:12px; }
header,li { display:flex; align-items:center; gap:6px; min-height:28px; }
header { justify-content:space-between; color:#858585; font-size:11px; }
ol { margin:0; padding:0; list-style:none; }
li { border-radius:5px; transition:background-color 160ms,opacity 160ms; } li.target { box-shadow:inset 0 2px #999; } li.dragging { opacity:.4; }
li p { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin:0; }
button { display:grid; place-items:center; width:24px; height:24px; padding:0; border:0; border-radius:4px; color:inherit; background:transparent; cursor:pointer; }
button:hover { background:rgba(128,128,128,.15); } button:focus-visible { outline:2px solid #007acc; } button:disabled { opacity:.3; cursor:default; } button svg { width:14px; height:14px; }
.queue-grip { color:#999; cursor:grab; }.queue-steering { color:#858585; font-size:11px; }
:global(.dark) .composer-queue { color:#d4d4d4; }
@media(prefers-reduced-motion:reduce) { li { transition:none; } }
</style>
