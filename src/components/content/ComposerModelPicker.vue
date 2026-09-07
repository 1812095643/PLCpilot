<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { IconArrowLeft, IconBoltFilled, IconCheck, IconChevronRight, IconRotateClockwise2 } from '@tabler/icons-vue'
import type { ReasoningEffort } from '../../types/codex'
import MaxEffortParticles from './MaxEffortParticles.vue'

const props = defineProps<{
  models: Array<{ id: string; name: string; model: string }>
  selectedModel: string
  selectedReasoningEffort: ReasoningEffort | ''
  reasoningEfforts: ReasoningEffort[]
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:selected-model': [id: string]
  'update:selected-reasoning-effort': [effort: ReasoningEffort]
}>()

const labels: Record<ReasoningEffort, string> = {
  none: '不思考', minimal: '轻量', low: '低', medium: '标准', high: '高', xhigh: '极高', max: 'Max',
}
const orderedLevels = Object.keys(labels) as ReasoningEffort[]
const levels = computed(() => {
  const supported = orderedLevels.filter((level) => props.reasoningEfforts.includes(level))
  return supported.length ? supported : orderedLevels
})
const selectedIndex = computed(() => {
  const index = levels.value.indexOf(props.selectedReasoningEffort || 'medium')
  return index >= 0 ? index : Math.max(0, levels.value.indexOf('medium'))
})
const selectedLevel = computed(() => levels.value[selectedIndex.value] ?? 'medium')
const effortLabel = computed(() => labels[selectedLevel.value])
const accessibleLabel = computed(() => selectedLevel.value === 'max' ? 'Max（最高）' : effortLabel.value)
const isMaxEffort = computed(() => selectedLevel.value === 'max')
const effortColors: Record<ReasoningEffort, string> = {
  none: '#d0e5fc', minimal: '#acd0f7', low: '#82b6ee', medium: '#548eda', high: '#326bbe', xhigh: '#234d94', max: '#a372ed',
}
const models = computed(() => props.models.filter((model, index, all) => model.id && all.findIndex((item) => item.id === model.id) === index))
const selected = computed(() => models.value.find((model) => model.id === props.selectedModel) ?? models.value[0])
const modelLabel = computed(() => selected.value?.name || selected.value?.model || '选择模型')
const isOpen = shallowRef(false)
const view = shallowRef<'effort' | 'models'>('effort')
const query = shallowRef('')
const isDragging = shallowRef(false)
const rootRef = useTemplateRef<HTMLElement>('root')
const triggerRef = useTemplateRef<HTMLButtonElement>('trigger')
const rangeRef = useTemplateRef<HTMLInputElement>('range')
const searchRef = useTemplateRef<HTMLInputElement>('search')
const dialogId = useId()
const filteredModels = computed(() => {
  const text = query.value.trim().toLowerCase()
  return models.value.filter((model) => `${model.name} ${model.model}`.toLowerCase().includes(text))
})
const defaultLevel = computed(() => levels.value.includes('medium') ? 'medium' : levels.value[0] ?? 'none')
const SLIDER_THUMB_SIZE = 30
const rangeStyle = computed(() => {
  const ratio = selectedIndex.value / Math.max(1, levels.value.length - 1)
  // 圆形滑块、原生拖动区域和填充边界共用尺寸，缩小后仍准确对齐每个档位。
  return {
    '--effort-thumb-size': `${SLIDER_THUMB_SIZE}px`,
    '--effort-percent': `${ratio * 100}%`,
    '--effort-inset': `${SLIDER_THUMB_SIZE * (0.5 - ratio)}px`,
    '--effort-color': effortColors[selectedLevel.value],
  }
})

async function toggle(): Promise<void> {
  if (props.disabled) return
  if (isOpen.value) { close(); return }
  view.value = 'effort'
  query.value = ''
  isOpen.value = true
  await nextTick()
  rangeRef.value?.focus({ preventScroll: true })
}

function close(restoreFocus = false): void {
  isOpen.value = false
  isDragging.value = false
  if (restoreFocus) triggerRef.value?.focus({ preventScroll: true })
}

async function changeView(next: 'effort' | 'models'): Promise<void> {
  view.value = next
  query.value = ''
  await nextTick()
  const input = next === 'models' ? searchRef.value : rangeRef.value
  input?.focus({ preventScroll: true })
}

async function selectModel(id: string): Promise<void> {
  emit('update:selected-model', id)
  await changeView('effort')
}

function onInput(event: Event): void {
  const input = event.target as HTMLInputElement
  const level = levels.value[Number(input.value)]
  if (level && !props.disabled) emit('update:selected-reasoning-effort', level)
}

function onEscape(): void {
  if (view.value === 'models') void changeView('effort')
  else close(true)
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (isOpen.value && event.target instanceof Node && !rootRef.value?.contains(event.target)) close()
}

function onFocusOut(event: FocusEvent): void {
  if (isOpen.value && event.relatedTarget instanceof Node && !rootRef.value?.contains(event.relatedTarget)) close()
}

watch(() => props.disabled, (disabled) => { if (disabled) close() })
onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<template>
  <div ref="root" class="model-picker" @keydown.esc.stop.prevent="onEscape" @focusout="onFocusOut">
    <button ref="trigger" type="button" class="model-picker-trigger" :disabled="props.disabled"
      :aria-expanded="isOpen" :aria-controls="isOpen ? dialogId : undefined" aria-haspopup="dialog"
      :title="`${modelLabel} · ${accessibleLabel}`" @click.stop="toggle">
      <span class="model-picker-trigger-name">{{ modelLabel }}</span>
      <span aria-hidden="true">·</span><span class="model-picker-trigger-effort">{{ effortLabel }}</span>
    </button>

    <div v-if="isOpen" :id="dialogId" class="model-picker-popover" role="dialog" aria-label="模型和思考等级" @click.stop>
      <div v-if="view === 'effort'" class="effort-view">
        <div class="effort-heading">
          <IconBoltFilled class="effort-bolt" aria-hidden="true" />
          <button type="button" class="effort-model-button" aria-label="切换模型" title="切换模型" @click="changeView('models')">
            <span class="effort-title"><span :key="selectedLevel" class="effort-title-label">{{ effortLabel }}</span><IconChevronRight aria-hidden="true" /></span>
            <span class="effort-model-name" :title="modelLabel">{{ modelLabel }}</span>
          </button>
          <button type="button" class="effort-reset" :aria-label="`重置为${labels[defaultLevel]}`" :title="`重置为${labels[defaultLevel]}`"
            @click="emit('update:selected-reasoning-effort', defaultLevel)"><IconRotateClockwise2 aria-hidden="true" /></button>
        </div>

        <div class="effort-slider" :class="{ 'is-dragging': isDragging, 'is-fixed': levels.length === 1, 'is-max': isMaxEffort }" :style="rangeStyle">
          <div class="effort-track" aria-hidden="true">
            <span class="effort-track-rest" />
            <MaxEffortParticles v-if="isMaxEffort" />
          </div>
          <div class="effort-stops" aria-hidden="true">
            <span v-for="(level, index) in levels" :key="level" :class="{ 'is-passed': index < selectedIndex }" />
          </div>
          <div class="effort-thumb-lane" aria-hidden="true"><span class="effort-thumb" /></div>
          <!-- 原生 range 保留拖动、触控和键盘语义，视觉滑块独立渲染以平滑吸附到档位。 -->
          <input ref="range" class="effort-range" type="range" min="0" :max="Math.max(1, levels.length - 1)" step="1"
            :value="selectedIndex" :disabled="props.disabled || levels.length === 1"
            aria-label="思考深度" :aria-valuetext="accessibleLabel" :title="accessibleLabel" @input="onInput"
            @pointerdown="isDragging = true" @pointerup="isDragging = false" @pointercancel="isDragging = false" @blur="isDragging = false" />
        </div>
      </div>

      <div v-else class="model-list-view">
        <div class="model-list-heading">
          <button type="button" class="model-list-back" aria-label="返回思考深度" title="返回思考深度" @click="changeView('effort')"><IconArrowLeft aria-hidden="true" /></button>
          <span>选择模型</span>
        </div>
        <input ref="search" v-model="query" class="model-search" type="search" placeholder="搜索模型" aria-label="搜索模型" />
        <div class="model-list" role="listbox" aria-label="可用模型">
          <button v-for="model in filteredModels" :key="model.id" type="button" class="model-option" role="option"
            :aria-selected="model.id === props.selectedModel" :title="`${model.name || model.model} · ${model.model}`" @click="selectModel(model.id)">
            <span class="model-option-copy"><span>{{ model.name || model.model }}</span><small v-if="model.name && model.name !== model.model">{{ model.model }}</small></span>
            <IconCheck v-if="model.id === props.selectedModel" aria-hidden="true" />
          </button>
          <p v-if="!filteredModels.length" class="model-empty">没有匹配的模型</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.model-picker { position: relative; flex: 0 0 auto; letter-spacing: 0; }
.model-picker-trigger { display: inline-flex; align-items: center; gap: 4px; height: 26px; max-width: 180px; border: 0; border-radius: 999px; padding: 0 7px; background: transparent; color: var(--composer-muted); font-size: 11px; cursor: pointer; }
.model-picker-trigger:hover, .model-picker-trigger[aria-expanded='true'] { background: var(--composer-soft); color: var(--composer-text); }
.model-picker-trigger-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.model-picker-trigger-effort { flex: 0 0 auto; white-space: nowrap; }
.model-picker-trigger:disabled { opacity: 0.45; cursor: not-allowed; }
.model-picker-popover {
  --picker-surface: #fff;
  --picker-text: #292929;
  --picker-muted: #707070;
  --picker-hover: #f2f2f2;
  --picker-accent: #7951bb;
  --picker-track: #e2e0e9;
  position: absolute; bottom: calc(100% + 8px); right: 0; z-index: 360;
  width: min(248px, calc(100vw - 104px)); max-height: min(360px, calc(100dvh - 96px));
  box-sizing: border-box; border-radius: 14px; padding: 12px;
  background: var(--picker-surface); color: var(--picker-text);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 8%), 0 4px 8px rgb(0 0 0 / 5%), 0 16px 38px rgb(0 0 0 / 14%);
  transform-origin: bottom right; animation: picker-enter 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
.effort-heading { display: grid; grid-template-columns: 20px minmax(0, 1fr) 20px; gap: 6px; align-items: start; }
.effort-bolt { width: 16px; height: 16px; margin: 2px; color: var(--picker-accent); }
.effort-model-button { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; border: 0; padding: 0; background: transparent; cursor: pointer; }
.effort-title { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 20px; color: var(--picker-accent); font-size: 14px; font-weight: 500; line-height: 20px; }
.effort-title-label { animation: effort-label-enter 160ms ease-out; }
.effort-title svg { width: 12px; height: 12px; margin-right: -18px; color: var(--picker-muted); stroke-width: 1.7; }
.effort-model-name { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--picker-muted); font-size: 12px; line-height: 17px; }
.effort-model-button:hover .effort-model-name { color: var(--picker-text); }
.effort-reset, .model-list-back { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--picker-muted); cursor: pointer; }
.effort-reset:hover, .model-list-back:hover { background: var(--picker-hover); color: var(--picker-text); }
.effort-reset svg { width: 18px; height: 18px; stroke-width: 1.65; transition: transform 200ms ease-out; }
.effort-reset:active svg { transform: rotate(55deg); }
.effort-slider { position: relative; height: var(--effort-thumb-size); margin-top: 10px; border-radius: 999px; }
.effort-track { position: absolute; inset: 2px 0; overflow: hidden; border-radius: 999px; background: var(--effort-color); box-shadow: inset 0 1px 1px rgb(255 255 255 / 18%); transition: background-color 160ms ease; }
.effort-slider.is-max .effort-track { background: linear-gradient(100deg, #8295fc 0%, #a992fa 38%, #a372ed 60%, #7749d0 82%, #5b34ab 100%); }
.effort-track-rest { position: absolute; inset: 0; background: var(--picker-track); transform: translateX(calc(var(--effort-percent) + var(--effort-inset))); transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1); }
.effort-stops { position: absolute; inset: 0 calc(var(--effort-thumb-size) / 2); display: flex; align-items: center; justify-content: space-between; pointer-events: none; }
.effort-stops span { width: 3px; height: 3px; border-radius: 50%; background: rgb(85 70 113 / 25%); }
.effort-stops span.is-passed { background: rgb(255 255 255 / 55%); }
.effort-thumb-lane { position: absolute; top: 0; left: 0; width: calc(100% - var(--effort-thumb-size)); height: var(--effort-thumb-size); pointer-events: none; transform: translateX(var(--effort-percent)); transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1); }
.effort-thumb { display: block; width: var(--effort-thumb-size); height: var(--effort-thumb-size); border-radius: 50%; background: #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / 5%), 0 2px 5px rgb(0 0 0 / 15%); transition: transform 160ms ease-out; }
.effort-slider.is-dragging .effort-thumb { transform: scale(1.04); }
.effort-range { position: absolute; inset: 0; width: 100%; height: var(--effort-thumb-size); margin: 0; padding: 0; opacity: 0; cursor: grab; touch-action: pan-y; }
.effort-range:active { cursor: grabbing; }
.effort-range::-webkit-slider-thumb { appearance: none; width: var(--effort-thumb-size); height: var(--effort-thumb-size); }
.effort-range::-webkit-slider-runnable-track { height: var(--effort-thumb-size); }
.effort-range { appearance: none; }
.effort-range::-moz-range-thumb { width: var(--effort-thumb-size); height: var(--effort-thumb-size); border: 0; }
.effort-slider:has(.effort-range:focus-visible), .model-picker-trigger:focus-visible,
.effort-model-button:focus-visible, .effort-reset:focus-visible, .model-option:focus-visible,
.model-list-back:focus-visible { outline: 2px solid #9d7dda; outline-offset: 4px; }
.effort-slider.is-fixed { opacity: 0.6; }
.effort-range:disabled { cursor: not-allowed; }
.model-list-view { display: flex; flex-direction: column; gap: 12px; }
.model-list-heading { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; }
.model-list-back svg { width: 18px; height: 18px; }
.model-search { width: 100%; min-width: 0; height: 32px; border: 1px solid transparent; border-radius: 6px; background: var(--picker-hover); padding: 0 10px; color: var(--picker-text); font-size: 12px; outline: none; }
.model-search:focus { border-color: var(--picker-accent); }
.model-list { display: flex; flex-direction: column; gap: 3px; max-height: 220px; overflow-y: auto; }
.model-option { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 34px; padding: 7px 9px; border: 0; border-radius: 6px; background: transparent; color: var(--picker-text); text-align: left; font-size: 12px; cursor: pointer; }
.model-option:hover, .model-option[aria-selected='true'] { background: var(--picker-hover); }
.model-option-copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.model-option-copy > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-option-copy small { color: var(--picker-muted); font-size: 11px; }
.model-option svg { flex-shrink: 0; width: 15px; height: 15px; }
.model-empty { margin: 8px; color: var(--picker-muted); font-size: 12px; }
/* 整个主题后代选择器放入 :global，避免当前编译链把它截成 :root.dark。 */
:global(:root.dark .model-picker-popover) { --picker-surface: #282828; --picker-text: #ececec; --picker-muted: #b9b9b9; --picker-hover: #353535; --picker-accent: #b59aec; --picker-track: #414043; box-shadow: 0 0 0 1px rgb(255 255 255 / 10%), inset 0 1px 1px rgb(255 255 255 / 3%), 0 12px 32px rgb(0 0 0 / 26%); }
:global(:root.dark .effort-stops span) { background: rgb(255 255 255 / 25%); }
:global(:root.dark .effort-stops span.is-passed) { background: rgb(255 255 255 / 55%); }
@keyframes picker-enter { from { opacity: 0; transform: translateY(5px) scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes effort-label-enter { from { opacity: 0.45; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .model-picker-popover, .effort-title-label { animation: none; }.effort-thumb-lane, .effort-track-rest, .effort-thumb, .effort-reset svg { transition: none; } }
</style>
