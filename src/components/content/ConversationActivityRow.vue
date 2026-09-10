<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { IconTerminal2, IconFileText, IconSearch, IconPlug, IconWifi, IconBrain, IconChevronDown, IconCheck, IconCopy } from '@tabler/icons-vue'
import type { CommandExecutionData } from '../../types/codex'
import { copyTextToClipboard } from '../../utils/clipboard'

const props = defineProps<{ execution: CommandExecutionData }>()
const expanded = shallowRef(false)
const copied = shallowRef(false)
const running = computed(() => props.execution.status === 'inProgress')
const terminal = computed(() => props.execution.kind === 'command' || /(^|__|[.:/\\])(bash|shell|exec_command|exec|command|powershell|pwsh)$/iu.test(props.execution.tool || ''))
const icon = computed(() => props.execution.kind === 'retry' ? IconWifi : props.execution.kind === 'thinking' || props.execution.kind === 'model' ? IconBrain : terminal.value ? IconTerminal2 : /read|读取/iu.test(props.execution.tool || props.execution.command) ? IconFileText : /grep|find|search|glob/iu.test(props.execution.tool || '') ? IconSearch : IconPlug)
function decode(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}
function contentText(value: unknown): string {
  const decoded = decode(value)
  if (typeof decoded === 'string') return decoded
  if (!decoded || typeof decoded !== 'object') return ''
  if (Array.isArray(decoded)) return decoded.map(contentText).filter(Boolean).join('\n')
  const record = decoded as Record<string, unknown>
  if (Array.isArray(record.content)) return record.content.map(contentText).filter(Boolean).join('\n')
  if (typeof record.text === 'string') return record.text
  return JSON.stringify(record, null, 2)
}
const detail = computed(() => {
  const decoded = decode(props.execution.aggregatedOutput)
  const record = decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded as Record<string, unknown> : null
  const args = decode(record?.arguments ?? record)
  const command = args && typeof args === 'object' ? String((args as Record<string, unknown>).command ?? '') : ''
  return {
    command: terminal.value ? command || props.execution.command.replace(/^(?:正在运行|已运行|未能运行)\s*/u, '') : '',
    output: contentText(record && 'output' in record ? record.output : decoded),
  }
})
const statusText = computed(() => ({ inProgress: '运行中', completed: '成功', failed: '未完成', declined: '已拒绝', interrupted: '已停止', waiting: '等待审批' })[props.execution.status])
const hasDetails = computed(() => Boolean(detail.value.output.trim() && detail.value.output.trim() !== props.execution.command.trim()))
async function copy(): Promise<void> {
  try { await copyTextToClipboard([detail.value.command, detail.value.output].filter(Boolean).join('\n\n')); copied.value = true }
  catch { copied.value = false }
}
</script>

<template>
  <div class="activity-entry" :data-status="execution.status">
    <button class="activity-heading" type="button" :aria-expanded="expanded" :disabled="!hasDetails" :title="execution.command" @click="expanded = !expanded">
      <component :is="icon" :size="15" stroke="1.5" class="activity-icon" aria-hidden="true" />
      <span class="activity-title" :class="{ shimmering: running }">{{ execution.command }}</span>
      <IconChevronDown v-if="hasDetails" class="activity-chevron" :class="{ expanded }" :size="12" stroke="1.5" aria-hidden="true" />
    </button>
    <div class="activity-expansion" :class="{ expanded }" :inert="!expanded">
      <div class="activity-expansion-inner">
        <div class="activity-panel">
          <header class="activity-panel-header"><span>{{ terminal ? 'Shell' : execution.kind === 'retry' ? '连接详情' : execution.tool || '工具详情' }}</span><button type="button" class="activity-copy" :aria-label="copied ? '已复制详情' : '复制详情'" @click="copy"><IconCheck v-if="copied" :size="13" /><IconCopy v-else :size="13" /></button></header>
          <div class="activity-output-scroll" tabindex="0" aria-label="工具执行详情">
            <pre v-if="detail.command" class="activity-command">$ {{ detail.command }}</pre>
            <pre class="activity-output">{{ detail.output || (running ? '等待输出…' : '没有文本输出') }}</pre>
          </div>
          <footer class="activity-panel-footer"><IconCheck v-if="execution.status === 'completed'" :size="12" /><span>{{ statusText }}</span><span v-if="execution.exitCode !== null && execution.exitCode !== 0">· 退出码 {{ execution.exitCode }}</span></footer>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.activity-entry { --activity-muted:#74777e; --activity-text:#33373e; --activity-panel:#f6f7f8; --activity-edge:#dcdfe2; min-width:0; width:100%; }
:global(.dark) .activity-entry { --activity-muted:#92969e; --activity-text:#c4c8ce; --activity-panel:#252629; --activity-edge:#3b3d42; }
.activity-heading { display:flex; align-items:center; gap:6px; width:100%; min-width:0; min-height:22px; padding:1px 0; border:0; background:transparent; color:var(--activity-muted); text-align:left; font-size:12px; line-height:18px; cursor:pointer; }
.activity-heading:disabled { cursor:default; }.activity-heading:hover:not(:disabled) { color:var(--activity-text); }.activity-icon,.activity-chevron { flex-shrink:0; }
.activity-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:450; }.activity-chevron { transition:transform 180ms ease; transform:rotate(-90deg); }.activity-chevron.expanded { transform:rotate(0deg); }
.activity-expansion { display:grid; grid-template-rows:0fr; opacity:0; transition:grid-template-rows 220ms ease,opacity 180ms ease; }.activity-expansion.expanded { grid-template-rows:1fr; opacity:1; }
.activity-expansion-inner { min-height:0; overflow:hidden; }.activity-panel { margin:2px 1px 5px; border:1px solid var(--activity-edge); border-radius:10px; background:var(--activity-panel); color:var(--activity-text); overflow:hidden; }
.activity-panel-header { display:flex; justify-content:space-between; align-items:center; min-height:30px; padding:5px 10px; font-size:11px; color:var(--activity-muted); }.activity-copy { display:grid; place-items:center; width:22px; height:22px; padding:0; border:0; border-radius:4px; background:transparent; color:inherit; opacity:0; }.activity-panel:hover .activity-copy,.activity-copy:focus-visible { opacity:1; }.activity-copy:hover { background:color-mix(in srgb,currentColor 10%,transparent); }
.activity-output-scroll { max-height:230px; overflow:auto; padding:0 10px 10px; }.activity-command,.activity-output { margin:0; font-family:Consolas,'Cascadia Code',monospace; font-size:11px; line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; }.activity-command { margin:1px 0 20px; font-weight:600; }.activity-panel-footer { display:flex; justify-content:flex-end; align-items:center; gap:4px; min-height:23px; padding:0 10px 6px; font-size:10px; color:var(--activity-muted); }
.activity-entry[data-status='failed'] .activity-heading,.activity-entry[data-status='declined'] .activity-heading { color:#bb6565; }
.shimmering { color:transparent; background:linear-gradient(100deg,var(--activity-muted) 25%,var(--activity-text) 49%,var(--activity-muted) 73%); background-size:250% 100%; background-clip:text; -webkit-background-clip:text; animation:activity-shimmer 3.6s ease-in-out infinite; }
@keyframes activity-shimmer { from { background-position:140% 0; } to { background-position:-140% 0; } }
button:focus-visible,.activity-output-scroll:focus-visible { outline:2px solid #007acc; outline-offset:3px; border-radius:4px; }
@media (prefers-reduced-motion:reduce) { .activity-expansion,.activity-chevron { transition:none; }.shimmering { animation:none; color:var(--activity-muted); } }
</style>
