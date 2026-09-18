<script setup lang="ts">
import { IconChevronDown } from '@tabler/icons-vue'

defineProps<{ label: string; expanded: boolean; hasDetails: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <div class="turn-summary">
    <button v-if="hasDetails" type="button" class="turn-summary-toggle" :aria-expanded="expanded"
      :aria-label="`${label}，${expanded ? '收起' : '展开'}操作过程`" @click="emit('toggle')">
      <span>{{ label }}</span>
      <IconChevronDown :size="12" stroke="1.5" :class="{ expanded }" aria-hidden="true" />
    </button>
    <span v-else class="turn-summary-label">{{ label }}</span>
  </div>
</template>

<style scoped>
.turn-summary { width:100%; margin:2px 0 6px; padding-bottom:8px; border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent); color:#858990; }
.turn-summary-toggle, .turn-summary-label { display:inline-flex; align-items:center; gap:5px; min-height:22px; font-size:12px; line-height:20px; }
.turn-summary-toggle { padding:0; border:0; background:transparent; color:inherit; cursor:pointer; }
.turn-summary-toggle:hover { color:#33373e; }
.turn-summary-toggle:focus-visible { outline:2px solid #007acc; outline-offset:3px; border-radius:3px; }
.turn-summary-toggle svg { transform:rotate(-90deg); transition:transform 180ms ease; }
.turn-summary-toggle svg.expanded { transform:rotate(0); }
:global(.dark .turn-summary-toggle:hover) { color:#d4d4d4; }
@media(prefers-reduced-motion:reduce) { .turn-summary-toggle svg { transition:none; } }
</style>
