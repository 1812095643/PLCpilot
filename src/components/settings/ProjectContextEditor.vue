<script setup lang="ts">
import { reactive, watch } from 'vue'

export type ContextDraft = { id?: string; title: string; content: string }
const props = defineProps<{ draft: ContextDraft; kind: 'memory' | 'knowledge'; busy: boolean }>()
const emit = defineEmits<{ save: [draft: ContextDraft]; cancel: [] }>()
const fields = reactive<ContextDraft>({ title: '', content: '' })
watch(() => props.draft, value => Object.assign(fields, { id: undefined }, value), { immediate: true })
</script>

<template>
  <form class="settings-form context-editor" @submit.prevent="emit('save', { ...fields })">
    <div class="context-editor-heading"><strong>{{ draft.id ? '编辑条目' : '新建条目' }}</strong><button class="settings-command" type="button" :disabled="busy" @click="emit('cancel')">取消</button></div>
    <label>名称<input v-model="fields.title" required maxlength="100" :disabled="busy" :placeholder="kind === 'knowledge' ? '例如：设备通信协议' : '例如：项目约定'" /></label>
    <label>内容<textarea v-model="fields.content" required :maxlength="kind === 'knowledge' ? 50000 : 12000" :disabled="busy" :placeholder="kind === 'knowledge' ? '项目说明、接口约定或调试记录' : '记录后续任务可参考的事实和约定，请勿包含密钥'" /></label>
    <footer><span class="settings-feedback">{{ fields.content.length }} 字符</span><button class="settings-command" type="submit" :disabled="busy || !fields.content.trim() || !fields.title.trim()">{{ busy ? '正在保存…' : '保存' }}</button></footer>
  </form>
</template>

<style scoped>
.context-editor { max-width: none; margin: 16px 0 0; padding: 0 0 20px; border-bottom: 1px solid var(--settings-line); gap: 12px; }
.context-editor-heading, .context-editor footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.context-editor-heading strong { font-size: 13px; font-weight: 550; }
.context-editor textarea { min-height: 180px; line-height: 1.65; font-family: inherit; }
</style>
