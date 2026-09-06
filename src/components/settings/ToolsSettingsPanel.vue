<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { ToolSummary } from '../../api/plcBridge'

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
        <div class="tools-matrix-main"><strong>{{ tool.name }}</strong><code>{{ tool.qualified_name }}</code><p>{{ tool.description || '未提供描述' }}</p></div>
        <div class="tools-matrix-meta"><span>{{ tool.source || 'MCP' }}</span><span :data-risk="tool.mutating ? 'write' : 'read'">{{ tool.risk || (tool.mutating ? '审批后修改' : '只读') }}</span><span>{{ tool.available ? '可用' : '不可用' }}</span></div>
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
.tools-matrix-row { display: flex; min-width: 0; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--settings-line); padding: 13px 0; }
.tools-matrix-main { min-width: 0; flex: 1; }.tools-matrix-main strong { display: block; font-size: 13px; }.tools-matrix-main code { display: block; margin-top: 3px; color: var(--settings-muted); font-size: 11px; overflow-wrap: anywhere; }.tools-matrix-main p { margin: 6px 0 0; color: var(--settings-muted); font-size: 12px; }
.tools-matrix-meta { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: 6px; color: var(--settings-muted); font-size: 11px; }.tools-matrix-meta span { border: 1px solid var(--settings-line); border-radius: 999px; padding: 3px 7px; }.tools-matrix-meta span[data-risk='write'] { color: #c42b1c; }
@media (max-width: 680px) { .tools-matrix-row { flex-direction: column; }.tools-matrix-meta { justify-content: flex-start; } }
</style>
