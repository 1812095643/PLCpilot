<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { ToolSummary } from '../../api/plcBridge'
import IconTablerChevronDown from '../icons/IconTablerChevronDown.vue'

const props = defineProps<{ tools: ToolSummary[] }>()
const query = shallowRef('')
const onlyWritable = shallowRef(false)
const visibleTools = computed(() => props.tools.filter((tool) => {
  const keyword = query.value.trim().toLowerCase()
  const matchesKeyword = !keyword || `${tool.qualified_name} ${tool.description || ''} ${tool.source}`.toLowerCase().includes(keyword)
  return matchesKeyword && (!onlyWritable.value || tool.mutating)
}))
</script>

<template>
  <section class="tools-settings-panel">
    <div class="settings-toolbar"><div><h2>工具目录</h2><p class="settings-feedback">按来源、能力和风险查看当前真实注册工具。</p></div><label class="tools-filter-check"><input v-model="onlyWritable" type="checkbox" /> 仅看修改工具</label></div>
    <input v-model="query" class="tools-filter-input" placeholder="搜索工具名称或用途" aria-label="搜索工具" />
    <div class="tools-matrix" role="list">
      <article v-for="tool in visibleTools" :key="tool.qualified_name" class="tools-matrix-row" role="listitem">
        <details>
          <summary class="tools-matrix-row-header">
            <strong class="tools-matrix-name" :title="tool.qualified_name">{{ tool.name }}</strong>
            <span class="tools-matrix-meta"><span class="tools-matrix-source">{{ tool.source || 'MCP' }}</span><span :data-risk="tool.mutating ? 'write' : 'read'">{{ tool.risk || (tool.mutating ? '审批后修改' : '只读') }}</span><span>{{ tool.available ? '可用' : '不可用' }}</span></span>
            <IconTablerChevronDown class="tools-matrix-chevron" aria-hidden="true" />
          </summary>
          <div class="tools-matrix-details">
            <code v-if="tool.qualified_name !== tool.name">{{ tool.qualified_name }}</code>
            <p>{{ tool.description || '未提供描述' }}</p>
          </div>
        </details>
      </article>
      <p v-if="visibleTools.length === 0" class="settings-feedback">没有匹配的工具。</p>
    </div>
  </section>
</template>

<style scoped>
.tools-settings-panel { display: flex; min-width: 0; flex-direction: column; gap: 14px; }
.tools-settings-panel h2 { margin: 0 0 5px; }
.tools-filter-check { display: inline-flex; align-items: center; gap: 7px; color: var(--settings-muted); font-size: 12px; }
.tools-filter-input { width: 100%; box-sizing: border-box; min-height: 36px; border: 1px solid var(--settings-line); border-radius: 5px; background: var(--settings-field); color: var(--settings-text); padding: 8px 10px; }
.tools-matrix { display: flex; min-width: 0; flex-direction: column; }
.tools-matrix-row { min-width: 0; border-bottom: 1px solid var(--settings-line); }
.tools-matrix-row-header { display: flex; width: 100%; min-width: 0; min-height: 46px; align-items: center; gap: 12px; padding: 9px 4px; border: 0; border-radius: 5px; list-style: none; background: transparent; color: var(--settings-text); text-align: left; cursor: pointer; }
.tools-matrix-row-header::-webkit-details-marker { display: none; }
.tools-matrix-row-header:focus-visible { outline: 2px solid var(--settings-muted); outline-offset: -2px; }
.tools-matrix-row-header:hover { background: color-mix(in srgb, var(--settings-field) 65%, transparent); }
.tools-matrix-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 550; }
.tools-matrix-meta { display: flex; min-width: 0; flex: 0 1 auto; align-items: center; gap: 6px; color: var(--settings-muted); font-size: 11px; white-space: nowrap; }
.tools-matrix-meta span { border: 1px solid var(--settings-line); border-radius: 999px; padding: 3px 7px; }
.tools-matrix-source { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.tools-matrix-meta span[data-risk='write'] { color: #c42b1c; }
:global(.dark .tools-matrix-meta span[data-risk='write']) { color: #f48771; }
.tools-matrix-chevron { width: 14px; height: 14px; flex: 0 0 14px; color: var(--settings-muted); transition: transform 160ms ease; }
.tools-matrix-row details[open] .tools-matrix-chevron { transform: rotate(180deg); }
.tools-matrix-details { padding: 0 30px 14px 4px; color: var(--settings-muted); font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
.tools-matrix-details code { font-size: 11px; }
.tools-matrix-details p { margin: 6px 0 0; white-space: pre-wrap; }
@media (max-width: 680px) { .tools-matrix-row-header { gap: 7px; }.tools-matrix-source { max-width: 80px; }.tools-matrix-meta { gap: 4px; }.tools-matrix-meta span { padding: 2px 5px; } }
@media (prefers-reduced-motion: reduce) { .tools-matrix-chevron { transition: none; } }
</style>
