<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type { ModelDiscoveryResult } from '../../api/plcBridge'

const props = defineProps<{ discovery: ModelDiscoveryResult; addedModelIds: string[]; saving: boolean }>()
const emit = defineEmits<{ add: [ids: string[]] }>()
const query = shallowRef('')
const selected = shallowRef<string[]>([])
const visible = computed(() => props.discovery.models.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const available = computed(() => visible.value.filter((model) => !props.addedModelIds.includes(model.id)))
const selectedIds = computed(() => selected.value.filter((id) => !props.addedModelIds.includes(id)))
const allSelected = computed(() => available.value.length > 0 && available.value.every((model) => selected.value.includes(model.id)))

function toggle(id: string): void {
  selected.value = selected.value.includes(id) ? selected.value.filter((item) => item !== id) : [...selected.value, id]
}
function toggleAll(): void {
  const ids = new Set(available.value.map((model) => model.id))
  selected.value = allSelected.value ? selected.value.filter((id) => !ids.has(id)) : [...new Set([...selected.value, ...ids])]
}
watch(() => props.discovery, () => { selected.value = []; query.value = '' })
</script>

<template>
  <section class="discovered-models" aria-label="选择要添加的模型">
    <header class="discovered-heading"><strong>可用模型 <span>{{ discovery.models.length }}</span></strong><span>勾选后添加到对话</span></header>
    <input v-model="query" class="discovered-search" type="search" placeholder="搜索模型" aria-label="搜索获取到的模型" />
    <div class="discovered-toolbar"><label><input type="checkbox" :checked="allSelected" :disabled="!available.length || saving" @change="toggleAll" />全选当前结果</label><span>{{ selectedIds.length }} 项已选</span></div>
    <div class="discovered-list">
      <label v-for="model in visible" :key="model.id" class="discovered-row" :class="{ added: addedModelIds.includes(model.id) }">
        <input type="checkbox" :checked="addedModelIds.includes(model.id) || selected.includes(model.id)" :disabled="addedModelIds.includes(model.id) || saving" @change="toggle(model.id)" />
        <span class="discovered-name"><strong>{{ model.name || model.id }}</strong><small v-if="model.name !== model.id">{{ model.id }}</small></span>
        <small v-if="addedModelIds.includes(model.id)">已添加</small>
      </label>
      <p v-if="!visible.length" class="discovered-empty">{{ discovery.models.length ? '没有匹配的模型' : '接口没有返回可用模型' }}</p>
    </div>
    <footer class="discovered-footer"><span>沿用当前接口和已保存的 Key</span><button type="button" :disabled="!selectedIds.length || saving" @click="emit('add', selectedIds)">{{ saving ? '正在添加…' : `添加所选模型${selectedIds.length ? `（${selectedIds.length}）` : ''}` }}</button></footer>
  </section>
</template>

<style scoped>
.discovered-models { display:flex; flex-direction:column; min-width:0; border-top:1px solid var(--settings-line); padding-top:18px; gap:12px; }
.discovered-heading,.discovered-toolbar,.discovered-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:12px; }
.discovered-heading strong { font-weight:550; }.discovered-heading span,.discovered-toolbar>span,.discovered-footer>span { color:var(--settings-muted); font-size:11px; }
.discovered-search { width:100%; min-height:34px; border:1px solid var(--settings-line); border-radius:6px; background:var(--settings-field); padding:7px 10px; color:var(--settings-text); font:inherit; font-size:12px; box-sizing:border-box; }
.discovered-toolbar label,.discovered-row { display:flex; align-items:center; gap:10px; cursor:pointer; }
input[type='checkbox'] { width:14px; height:14px; flex-shrink:0; margin:0; accent-color:#007acc; }
.discovered-list { max-height:250px; overflow:auto; display:flex; flex-direction:column; gap:2px; }
.discovered-row { min-height:38px; padding:7px 9px; border-radius:6px; font-size:12px; }.discovered-row:hover { background:var(--settings-field); }
.discovered-name { display:flex; flex-direction:column; gap:3px; min-width:0; flex:1; }.discovered-name strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:450; }
.discovered-row small,.discovered-empty { color:var(--settings-muted); font-size:11px; }.discovered-row.added { cursor:default; }
.discovered-footer { padding-top:12px; border-top:1px solid var(--settings-line); flex-wrap:wrap; }
.discovered-footer button { border:0; border-radius:6px; padding:8px 13px; background:var(--settings-text); color:var(--settings-bg, #fff); cursor:pointer; font-size:12px; }
.discovered-footer button:disabled { opacity:.4; cursor:default; } input:focus-visible,button:focus-visible { outline:2px solid #007acc; outline-offset:2px; }
</style>
