<script setup lang="ts">
import { onMounted, reactive, shallowRef } from 'vue'
import { getMcpConfigs, saveMcpServer, deleteMcpServer, probeMcpServer, listMcpCatalog, installMcpCatalog, type McpConfig, type McpCatalogEntry } from '../../api/settingsBridge'
import type { McpSummary, ToolSummary } from '../../api/plcBridge'
import IconTablerEdit from '../icons/IconTablerEdit.vue'
import IconTablerTrash from '../icons/IconTablerTrash.vue'
import IconTablerRefresh from '../icons/IconTablerRefresh.vue'
import IconTablerCopy from '../icons/IconTablerCopy.vue'
import { invoke } from '@tauri-apps/api/core'
const props = defineProps<{ summaries: McpSummary[] }>()
const emit = defineEmits<{ refresh: [] }>()
const servers = shallowRef<McpConfig[]>([])
const busy = shallowRef(false)
const feedback = shallowRef('')
const error = shallowRef(false)
const editing = shallowRef(false)
const tools = shallowRef<ToolSummary[]>([])
const catalog = shallowRef<McpCatalogEntry[]>([])
const form = reactive({ id: '', name: '', command: '', args: '[]', env: '{}', headers: '{}', enabled: true, transport: 'stdio' as 'stdio' | 'http', url: '', token: '' })
function summary(id: string) { return props.summaries.find((server) => server.id === id) }
async function load(): Promise<void> { servers.value = await getMcpConfigs() }
async function perform(action: () => Promise<unknown>): Promise<void> {
  busy.value = true; feedback.value = ''; error.value = false
  try { await action(); await load(); emit('refresh') } catch (reason) { error.value = true; feedback.value = String(reason) } finally { busy.value = false }
}
function edit(server?: McpConfig): void {
  const env = { ...(server?.env ?? {}) }; delete env.MCP_AUTH_TOKEN
  const headers = { ...(server?.headers ?? {}) }; delete headers.Authorization; delete headers.authorization
  Object.assign(form, { id: server?.id || '', name: server?.name || '', command: server?.command || '', args: JSON.stringify(server?.args || [], null, 2), env: JSON.stringify(env, null, 2), headers: JSON.stringify(headers, null, 2), enabled: server?.enabled ?? true, transport: server?.transport || 'stdio', url: server?.url || '', token: '' }); editing.value = true
}
async function save(): Promise<void> {
  await perform(async () => {
    const args: unknown = JSON.parse(form.args || '[]'); const env: unknown = JSON.parse(form.env || '{}'); const headers: unknown = JSON.parse(form.headers || '{}')
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new Error('启动参数需要是 JSON 字符串数组。')
    if (!env || Array.isArray(env) || typeof env !== 'object' || Object.values(env).some((value) => typeof value !== 'string')) throw new Error('环境变量需要是 JSON 字符串键值对象。')
    if (!headers || Array.isArray(headers) || typeof headers !== 'object' || Object.values(headers).some((value) => typeof value !== 'string')) throw new Error('请求头需要是 JSON 字符串键值对象。')
    await saveMcpServer({ id: form.id, name: form.name, command: form.command, args, env: { ...env as Record<string, string>, MCP_AUTH_TOKEN: form.token }, headers: headers as Record<string, string>, enabled: form.enabled, transport: form.transport, url: form.url || null })
    editing.value = false; feedback.value = 'MCP 配置已保存。'
  })
}
async function remove(server: McpConfig): Promise<void> {
  await perform(() => deleteMcpServer(server.id))
}
async function probe(server: McpConfig): Promise<void> { await perform(async () => { tools.value = await probeMcpServer(server.id); feedback.value = `已发现 ${tools.value.length} 个工具。` }) }
async function install(entry: McpCatalogEntry): Promise<void> { await perform(async () => { await installMcpCatalog(entry.id); feedback.value = `${entry.name} 已加入 MCP 配置。首次连接时会由 npx 获取真实包。` }) }
onMounted(() => void perform(async () => { await load(); catalog.value = await listMcpCatalog() }))
</script>

<template>
  <section><div class="settings-toolbar"><h2>MCP 服务</h2><div class="settings-actions"><button class="settings-command" :disabled="busy" @click="edit()">手动添加</button></div></div>
    <div v-if="catalog.length" class="mcp-catalog"><h3>免费 MCP 商店（{{ catalog.length }}）</h3><p class="settings-feedback">已包含官方通用能力和 CODESYS 社区实现。安装会写入本机配置；CODESYS 条目会自动带入检测到的 CODESYS 路径，并保留 Profile/参数供你复核。</p><div class="mcp-catalog-grid"><article v-for="entry in catalog" :key="entry.id" class="mcp-catalog-card"><div><strong>{{ entry.name }}</strong><p>{{ entry.description }}</p><small>{{ entry.source }} · {{ entry.license }} · {{ entry.package }}</small><small v-if="entry.notes">{{ entry.notes }}</small></div><button class="settings-command" :disabled="busy || summaries.some((item) => item.id === entry.id)" @click="install(entry)">{{ summaries.some((item) => item.id === entry.id) ? '已安装' : '安装' }}</button></article></div></div>
    <div class="settings-list"><div v-for="server in servers" :key="server.id" class="settings-list-row"><input type="checkbox" :checked="server.enabled" :disabled="busy" :aria-label="`启用 ${server.name}`" @change="perform(() => saveMcpServer({ ...server, enabled: ($event.target as HTMLInputElement).checked }))" /><div class="settings-row-copy"><strong>{{ server.name }}</strong><small>{{ server.transport === 'http' ? server.url : server.command }} · {{ !server.enabled ? '已关闭' : summary(server.id)?.connected ? `${summary(server.id)?.tool_count} 个工具` : '未连接' }}</small><p v-if="summary(server.id)?.last_error">{{ summary(server.id)?.last_error }}</p></div><div class="settings-actions"><button class="settings-icon" :disabled="busy || !server.enabled" :aria-label="`检查 ${server.name} 连接`" title="检查连接与工具" @click="probe(server)"><IconTablerRefresh /></button><button class="settings-icon" :disabled="busy" :aria-label="`编辑 ${server.name}`" title="编辑服务" @click="edit(server)"><IconTablerEdit /></button><button class="settings-icon" :disabled="busy" :aria-label="`复制 ${server.name}`" title="复制服务" @click="perform(() => invoke('duplicate_mcp_server', { id: server.id }))"><IconTablerCopy /></button><button class="settings-icon" :disabled="busy" :aria-label="`删除 ${server.name}`" title="删除服务" @click="remove(server)"><IconTablerTrash /></button></div></div></div>
    <p v-if="busy" class="settings-feedback" role="status">正在处理…</p><p v-if="feedback" class="settings-feedback" :class="{ error }" role="status">{{ feedback }}</p>
    <form v-if="editing" class="settings-form" @submit.prevent="save"><div class="settings-form-grid"><label>名称<input v-model="form.name" required /></label><label>传输方式<select v-model="form.transport"><option value="stdio">stdio</option><option value="http">Streamable HTTP</option></select></label></div><template v-if="form.transport === 'stdio'"><label>可执行文件<input v-model="form.command" required /></label><label>参数（JSON 数组）<textarea v-model="form.args" spellcheck="false" /></label><label>环境变量（JSON）<textarea v-model="form.env" spellcheck="false" /></label></template><label v-else>URL<input v-model="form.url" type="url" required /></label><label>自定义请求头（JSON）<textarea v-model="form.headers" spellcheck="false" placeholder="{ &quot;X-Workspace&quot;: &quot;plc&quot; }" /></label><label>认证令牌<input v-model="form.token" type="password" autocomplete="new-password" :placeholder="form.id ? '已保存的凭据保持不变' : ''" /></label><div class="settings-actions"><button class="settings-command" :disabled="busy">保存</button><button class="settings-command" type="button" @click="editing = false">取消</button></div></form>
    <div v-if="tools.length"><h3>已发现工具</h3><details v-for="tool in tools" :key="tool.qualified_name"><summary>{{ tool.qualified_name }}</summary><p class="settings-feedback">{{ tool.description }}</p><pre class="settings-source">{{ JSON.stringify(tool.input_schema, null, 2) }}</pre></details></div>
  </section>
</template>
