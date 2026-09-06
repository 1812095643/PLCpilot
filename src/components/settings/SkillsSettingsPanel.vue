<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { getSkillContent, type SkillSummary } from '../../api/plcBridge'
import { saveSkill, toggleSkill, deleteSkill, pickSkillPath, listSkillCatalog, installSkillCatalog, type SkillCatalogEntry } from '../../api/settingsBridge'
import IconTablerEdit from '../icons/IconTablerEdit.vue'
import IconTablerFolder from '../icons/IconTablerFolder.vue'
import IconTablerTrash from '../icons/IconTablerTrash.vue'
import IconTablerRefresh from '../icons/IconTablerRefresh.vue'
const props = defineProps<{ skills: SkillSummary[] }>()
const emit = defineEmits<{ refresh: [] }>()
const groups = computed(() => [{ scope: 'builtin', name: '内置' }, { scope: 'project', name: '项目' }, { scope: 'user', name: '用户目录' }, { scope: 'custom', name: '手动添加' }].map((group) => ({ ...group, skills: props.skills.filter((skill) => skill.scope === group.scope) })).filter((group) => group.skills.length))
const editing = shallowRef(false)
const editingId = shallowRef<string | undefined>()
const path = shallowRef('')
const busy = shallowRef(false)
const feedback = shallowRef('')
const sourceId = shallowRef('')
const source = shallowRef('')
const catalog = shallowRef<SkillCatalogEntry[]>([])
async function perform(action: () => Promise<unknown>): Promise<void> { busy.value = true; feedback.value = ''; try { await action(); emit('refresh') } catch (error) { feedback.value = String(error) } finally { busy.value = false } }
function edit(skill?: SkillSummary): void { editingId.value = skill?.id; path.value = skill?.path || ''; editing.value = true }
async function view(skill: SkillSummary): Promise<void> { if (sourceId.value === skill.id) { sourceId.value = ''; return } await perform(async () => { source.value = await getSkillContent(skill.id); sourceId.value = skill.id }) }
async function pick(): Promise<void> { await perform(async () => { const value = await pickSkillPath(); if (value) path.value = value }) }
async function save(): Promise<void> { await perform(async () => { await saveSkill(path.value, editingId.value); editing.value = false }) }
async function install(entry: SkillCatalogEntry): Promise<void> { await perform(async () => { await installSkillCatalog(entry.id); feedback.value = `${entry.name} 已安装并会在下一轮自动加载。` }) }
async function loadCatalog(): Promise<void> { catalog.value = await listSkillCatalog() }
onMounted(() => { void loadCatalog() })
</script>

<template>
  <section><div class="settings-toolbar"><h2>Skills</h2><div class="settings-actions"><button class="settings-icon" title="重新扫描" aria-label="重新扫描 Skills" :disabled="busy" @click="emit('refresh')"><IconTablerRefresh /></button><button class="settings-command" :disabled="busy" @click="edit()">手动添加</button></div></div>
    <div v-if="catalog.length" class="skill-catalog"><h3>免费 Skill 商店</h3><p class="settings-feedback">内置条目可安装到 C 盘应用目录，启用后会自动注入下一轮 PLC Agent 上下文。</p><div class="skill-catalog-grid"><article v-for="entry in catalog" :key="entry.id" class="skill-catalog-card"><div><strong>{{ entry.name }}</strong><p>{{ entry.description }}</p><small>{{ entry.source }} · {{ entry.license }}</small></div><button class="settings-command" :disabled="busy || entry.installed" @click="install(entry)">{{ entry.installed ? '已安装' : '安装' }}</button></article></div></div>
    <p v-if="feedback" class="settings-feedback error" role="status">{{ feedback }}</p>
    <form v-if="editing" class="settings-form" @submit.prevent="save"><label>Skill 目录或 SKILL.md 路径<input v-model="path" required /></label><div class="settings-actions"><button class="settings-icon" type="button" title="选择文件" aria-label="选择 SKILL.md" @click="pick"><IconTablerFolder /></button><button class="settings-command" :disabled="busy">保存</button><button class="settings-command" type="button" @click="editing = false">取消</button></div></form>
    <section v-for="group in groups" :key="group.scope"><h3>{{ group.name }}</h3><div v-for="skill in group.skills" :key="skill.id"><div class="settings-list-row"><input type="checkbox" :checked="skill.enabled" :disabled="busy" :aria-label="`启用 ${skill.name}`" @change="perform(() => toggleSkill(skill, ($event.target as HTMLInputElement).checked))" /><div class="settings-row-copy"><strong>{{ skill.name }}</strong><p>{{ skill.description }}</p><small v-if="skill.path">{{ skill.path }}</small><small v-if="!skill.content_available">内容无法读取</small></div><div class="settings-actions"><button class="settings-command" :disabled="busy || !skill.content_available" @click="view(skill)">{{ sourceId === skill.id ? '收起原文' : '原文' }}</button><template v-if="skill.scope === 'custom'"><button class="settings-icon" :disabled="busy" :aria-label="`编辑 ${skill.name} 路径`" title="编辑路径" @click="edit(skill)"><IconTablerEdit /></button><button class="settings-icon" :disabled="busy" :aria-label="`移除 ${skill.name}`" title="移除 Skill 配置" @click="perform(() => deleteSkill(skill.id))"><IconTablerTrash /></button></template></div></div><pre v-if="sourceId === skill.id" class="settings-source">{{ source }}</pre></div></section>
  </section>
</template>
