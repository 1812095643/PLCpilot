<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { IconTerminal2, IconPlug, IconChevronDown } from '@tabler/icons-vue'
import type { UiMessage } from '../../types/codex'
import ConversationActivityRow from './ConversationActivityRow.vue'
const props = defineProps<{ messages: UiMessage[] }>()
const expanded = shallowRef(false)
const isTerminal = computed(() => props.messages.every((message) => message.commandExecution?.kind === 'command'))
const label = computed(() => isTerminal.value ? `运行了 ${props.messages.length} 条命令` : `使用了 ${props.messages.length} 个工具`)
</script>

<template>
  <div class="activity-group">
    <button v-if="messages.length > 1" type="button" class="activity-group-toggle" :aria-expanded="expanded" @click="expanded = !expanded"><component :is="isTerminal ? IconTerminal2 : IconPlug" :size="15" stroke="1.5" /><span>{{ label }}</span><IconChevronDown :size="12" stroke="1.5" :class="{ expanded }" /></button>
    <div v-if="messages.length > 1" class="activity-group-expansion" :class="{ expanded }" :inert="!expanded"><div class="activity-group-inner"><template v-for="message in messages" :key="message.id"><ConversationActivityRow v-if="message.commandExecution" :execution="message.commandExecution" /></template></div></div>
    <ConversationActivityRow v-else-if="messages[0]?.commandExecution" :execution="messages[0].commandExecution" />
  </div>
</template>

<style scoped>
.activity-group { width:100%; min-width:0; }.activity-group-toggle { display:flex; align-items:center; gap:6px; min-height:28px; padding:3px 0; border:0; background:transparent; color:#74777e; font-size:12px; line-height:20px; text-align:left; }.activity-group-toggle svg:last-child { transform:rotate(-90deg); transition:transform 180ms ease; }.activity-group-toggle svg.expanded:last-child { transform:rotate(0deg); }.activity-group-toggle:hover { color:#33373e; }
:global(.dark) .activity-group-toggle { color:#92969e; }:global(.dark) .activity-group-toggle:hover { color:#c4c8ce; }
.activity-group-expansion { display:grid; grid-template-rows:0fr; opacity:0; transition:grid-template-rows 220ms ease,opacity 180ms ease; }.activity-group-expansion.expanded { grid-template-rows:1fr; opacity:1; }.activity-group-inner { min-height:0; overflow:hidden; }
.activity-group-toggle:focus-visible { outline:2px solid #007acc; outline-offset:3px; border-radius:4px; } @media(prefers-reduced-motion:reduce) { .activity-group-expansion,.activity-group-toggle svg { transition:none; } }
</style>
