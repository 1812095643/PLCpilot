<script setup lang="ts">
import { computed } from 'vue'
import type { CommandSummary } from '../../api/plcBridge'
import { filterSlashCommands } from '../../utils/slashCommands'

const props = withDefaults(defineProps<{
  commands: CommandSummary[]
  query?: string
  highlightedIndex: number
}>(), {
  query: '',
})

const emit = defineEmits<{
  select: [command: CommandSummary]
  'update:highlighted-index': [index: number]
}>()

const filteredCommands = computed(() => filterSlashCommands(props.commands, props.query))
const commandColumnWidth = computed(() => {
  const longest = props.commands.reduce((max, command) => Math.max(max, command.command.length), 0)
  return `${Math.min(188, Math.max(84, longest * 8 + 14))}px`
})

function choose(command: CommandSummary): void {
  emit('select', command)
}

function highlight(index: number): void {
  emit('update:highlighted-index', index)
}

function commandElementId(command: CommandSummary): string {
  return `plc-slash-command-${command.command.replace(/[^a-zA-Z0-9_-]/gu, '-')}`
}
</script>

<template>
  <div
    id="plc-slash-command-menu"
    class="plc-slash-command-menu"
    role="listbox"
    aria-label="斜杠命令"
    :style="{ '--slash-command-column-width': commandColumnWidth }"
  >
    <div v-if="filteredCommands.length > 0" class="plc-slash-command-list">
      <button
        v-for="(command, index) in filteredCommands"
        :id="commandElementId(command)"
        :key="command.command"
        type="button"
        class="plc-slash-command-row"
        :class="{ 'is-highlighted': index === highlightedIndex }"
        role="option"
        :aria-selected="index === highlightedIndex"
        :aria-label="`${command.command}：${command.detail || command.label}`"
        @pointerenter="highlight(index)"
        @mousedown.prevent="choose(command)"
      >
        <code class="plc-slash-command-name">{{ command.command }}</code>
        <span class="plc-slash-command-description">{{ command.detail || command.label }}</span>
      </button>
    </div>
    <p v-else class="plc-slash-command-empty">没有匹配的命令</p>
  </div>
</template>

<style scoped>
.plc-slash-command-menu {
  position: absolute;
  right: 12px;
  bottom: calc(100% + 8px);
  left: 12px;
  z-index: 40;
  width: auto;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid rgba(72, 66, 58, 0.18);
  border-radius: 6px;
  background: #fffdf9;
  box-shadow: 0 0 0 1px rgba(35, 29, 24, 0.04), 0 12px 26px rgba(35, 29, 24, 0.16);
}

.plc-slash-command-list {
  display: grid;
  gap: 1px;
}

.plc-slash-command-row {
  display: grid;
  grid-template-columns: var(--slash-command-column-width) minmax(0, 1fr);
  align-items: start;
  gap: 18px;
  width: 100%;
  min-height: 31px;
  padding: 5px 7px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #3a3530;
  cursor: pointer;
  text-align: left;
  transition: background-color 100ms ease;
}

.plc-slash-command-row:hover,
.plc-slash-command-row.is-highlighted {
  background: #e8f2fa;
}

.plc-slash-command-row:focus-visible {
  outline: 1px solid #007acc;
  outline-offset: -1px;
}

.plc-slash-command-name {
  overflow: hidden;
  color: #2f3a48;
  font: 12px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plc-slash-command-description {
  min-width: 0;
  overflow: hidden;
  color: #6e6760;
  font-size: 12px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plc-slash-command-empty {
  margin: 0;
  padding: 8px 7px;
  color: #6e6760;
  font-size: 12px;
}

:global(:root.dark) .plc-slash-command-row {
  color: var(--plc-dark-text);
}

:global(:root.dark) .plc-slash-command-row:hover,
:global(:root.dark) .plc-slash-command-row.is-highlighted {
  background: var(--plc-dark-selection);
}

:global(:root.dark) .plc-slash-command-row:focus-visible {
  outline-color: var(--plc-dark-accent);
}

:global(:root.dark) .plc-slash-command-name {
  color: #9cdcfe;
}

:global(:root.dark) .plc-slash-command-description,
:global(:root.dark) .plc-slash-command-empty {
  color: var(--plc-dark-muted);
}
</style>
