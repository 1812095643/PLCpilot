<script setup lang="ts">
import { computed } from 'vue'
import type { WorkspaceProject } from '../../api/plcBridge'
import { getPathLeafName, getPathParent, normalizePathForComparison, normalizePathForUi } from '../../pathUtils'
import ComposerSearchDropdown, { type SearchDropdownOption } from '../content/ComposerSearchDropdown.vue'

const props = withDefaults(defineProps<{ projects: WorkspaceProject[]; paths?: string[]; includeAll?: boolean; disabled?: boolean }>(), { paths: () => [], includeAll: false, disabled: false })
const model = defineModel<string>({ required: true })
function directory(path: string): string {
  return /\.(project|projectarchive)$/iu.test(path) ? getPathParent(path) : normalizePathForUi(path)
}
const options = computed<SearchDropdownOption[]>(() => {
  const entries = new Map<string, SearchDropdownOption>()
  for (const project of props.projects) {
    const path = directory(project.path)
    if (path) entries.set(normalizePathForComparison(path), { value: path, label: project.name || getPathLeafName(path), description: path })
  }
  for (const source of [...props.paths, model.value]) {
    const path = directory(source)
    const key = normalizePathForComparison(path)
    if (path && !entries.has(key)) entries.set(key, { value: path, label: getPathLeafName(path) || path, description: path })
  }
  const result = [...entries.values()]
  if (props.includeAll) result.unshift({ value: '', label: '全部项目' })
  return result
})
const selected = computed(() => options.value.find(option => normalizePathForComparison(option.value) === normalizePathForComparison(directory(model.value)))?.value ?? model.value)
</script>

<template>
  <ComposerSearchDropdown class="settings-project-picker" :options="options" :selected-values="[selected]" label="选择项目"
    placeholder="选择项目" search-placeholder="搜索项目名称或路径" :disabled="disabled || !options.length" @toggle="model = $event" />
</template>

<style scoped>
.settings-project-picker { display: flex; min-width: 0; }
.settings-project-picker :deep(.search-dropdown-trigger) { width: 100%; min-height: 34px; justify-content: space-between; gap: 12px; padding: 6px 10px; border: 1px solid var(--settings-line); border-radius: 5px; background: var(--settings-field); color: var(--settings-text); font-size: 12px; }
.settings-project-picker :deep(.search-dropdown-value) { color: inherit; }
.settings-project-picker :deep(.search-dropdown-trigger:focus-visible) { outline: 2px solid var(--settings-muted); outline-offset: 2px; }
</style>
