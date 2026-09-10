<script setup lang="ts">
import { onMounted, shallowRef } from 'vue'
import { getPreferences, saveContextSettings, type ContextSettings } from '../../api/settingsBridge'

defineProps<{ configDirectory: string }>()
const emit = defineEmits<{ notice: [message: string] }>()
const settings = shallowRef<ContextSettings>({ auto_compact: true, project_memory: true, auto_memory: true })
const ready = shallowRef(false)
const saving = shallowRef(false)
const rows: Array<{ key: keyof ContextSettings; title: string; detail: string }> = [
  { key: 'auto_compact', title: '自动压缩上下文', detail: '接近模型窗口上限时生成交接摘要，保留最近消息；原始历史仍可检索。' },
  { key: 'project_memory', title: '项目记忆', detail: '同一工作目录的会话共用经验和约定，不自动读取其他项目的记忆。' },
  { key: 'auto_memory', title: '自动保存任务回顾', detail: '复用已有摘要与公开结果，不额外请求模型。新任务先读短索引，需要时再读详情。' },
]

async function update(key: keyof ContextSettings, enabled: boolean): Promise<void> {
  const next = { ...settings.value, [key]: enabled }
  saving.value = true
  try {
    await saveContextSettings(next)
    settings.value = next
    emit('notice', '上下文设置已保存，将在下一轮任务生效。')
  } catch (error) {
    emit('notice', `设置尚未保存，请重试：${String(error)}`)
  } finally { saving.value = false }
}

onMounted(async () => {
  try { settings.value = (await getPreferences()).context_management; ready.value = true }
  catch (error) { emit('notice', `未能读取上下文设置：${String(error)}`) }
})
</script>

<template>
  <section class="context-settings" aria-label="记忆与上下文">
    <h2>记忆与上下文</h2>
    <p class="context-intro">长任务不断线，已完成的工作不必从头再来。</p>
    <label v-for="row in rows" :key="row.key" class="settings-field-row context-row">
      <span><strong>{{ row.title }}</strong><small>{{ row.detail }}</small></span>
      <input type="checkbox" role="switch" :checked="settings[row.key]" :disabled="!ready || saving || (row.key === 'auto_memory' && !settings.project_memory)" @change="update(row.key, ($event.target as HTMLInputElement).checked)" />
    </label>
    <p v-if="!ready" class="settings-feedback" role="status">正在读取设置…</p>
    <h3>任务笔记与原始历史</h3>
    <p class="settings-feedback">始终随当前会话保存。Agent 会记录执行位置，也可维护工作笔记；重新打开、建立分支或压缩后仍可按原始记录续接。输入 /compact 可手动整理上下文。</p>
    <h3>查看与忘记</h3>
    <p class="settings-feedback">在对话中说“查看当前项目的记忆”“记住这个项目约定”或“删除这条记忆”，Agent 会调用相应工具。关闭项目记忆会停止后续任务的自动读取与写入，不删除原记录。</p>
    <p class="settings-feedback">近期记忆检索范围为 90 天，每个项目最多保留 128 条近期索引。记忆仅供参考，不能代替当前工程检查或安全审批；保存前会过滤已知凭据及常见密钥格式。</p>
    <dl class="settings-storage"><dt>项目记忆</dt><dd>{{ configDirectory }}\memories\projects</dd><dt>笔记与摘要</dt><dd>保存在原会话 JSONL 内，不修改工程文件。</dd></dl>
  </section>
</template>

<style scoped>
.context-settings { max-width: 680px; }
.context-intro { margin: 0 0 20px; font-size: 13px; color: var(--settings-muted); }
.context-row { display: flex; gap: 24px; cursor: pointer; }
.context-row strong { font-size: 13px; font-weight: 500; }
.context-row small { display: block; margin-top: 6px; color: var(--settings-muted); font-size: 12px; line-height: 1.65; }
.context-row input { flex: 0 0 auto; cursor: pointer; }
.context-row input:disabled { cursor: default; opacity: .5; }
.context-row input:focus-visible { outline: 2px solid var(--settings-muted); outline-offset: 3px; }
.context-settings h3 { margin: 28px 0 8px; font-size: 13px; font-weight: 500; }
.context-settings .settings-feedback { line-height: 1.8; }
.context-settings .settings-storage { margin-top: 24px; line-height: 1.7; }
</style>
