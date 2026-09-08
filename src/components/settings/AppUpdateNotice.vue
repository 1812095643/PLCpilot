<script setup lang="ts">
import { IconArrowUpRight, IconX } from '@tabler/icons-vue'
defineProps<{ version: string }>()
const emit = defineEmits<{ open: []; dismiss: [] }>()
</script>
<template><aside class="app-update-notice" role="status"><button class="app-update-open" @click="emit('open')"><IconArrowUpRight /><span>PLC Pilot {{ version }} 可更新</span></button><button class="app-update-dismiss" aria-label="稍后更新" @click="emit('dismiss')"><IconX /></button></aside></template>
<style scoped>
.app-update-notice { position: fixed; z-index: 60; top: 48px; right: 18px; display: flex; align-items: center; padding: 5px; border-radius: 8px; color: #333; background: #fafafa; box-shadow: 0 0 0 1px #0000000d, 0 4px 18px #00000012; }
:global(.dark) .app-update-notice { color: #ddd; background: #2a2a2a; box-shadow: 0 0 0 1px #ffffff16, 0 4px 18px #00000033; }
.app-update-notice button { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 6px 8px; color: inherit; background: transparent; border: 0; border-radius: 4px; cursor: pointer; font-size: 12px; }
.app-update-notice button:hover { background: #88888818; }
.app-update-notice svg { width: 15px; height: 15px; }
</style>
