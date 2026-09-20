<script setup lang="ts">
import { computed } from 'vue'
import { IconBrain, IconCode, IconFileText, IconMessageCircle, IconSparkles } from '@tabler/icons-vue'
import type { WorkbenchMode } from '../../api/plcBridge'

type WelcomePrompt = {
  title: string
  description: string
  prompt: string
  icon: typeof IconBrain
}

const props = withDefaults(defineProps<{
  mode?: WorkbenchMode
  projectName?: string
  hasProject?: boolean
}>(), {
  mode: 'codesys',
  projectName: '',
  hasProject: false,
})

const emit = defineEmits<{
  select: [prompt: string]
}>()

const modeCopy = computed(() => {
  if (props.mode === 'stone') {
    return {
      eyebrow: 'STONE 工作台',
      title: '让 STone 工程更快完成',
      description: '查询 CAREL 接口、整理控制器代码，或从一个工程问题开始。',
    }
  }
  if (props.mode === 'chat') {
    return {
      eyebrow: '自由聊天',
      title: '今天想聊点什么？',
      description: '可以提问、分析文件，也可以让 PLC Pilot 帮你整理思路。',
    }
  }
  return {
    eyebrow: props.hasProject ? `当前工程 · ${props.projectName || '已连接'}` : 'CODESYS 工作台',
    title: '从一个工程问题开始',
    description: props.hasProject
      ? '描述要检查、修改或验证的内容，PLC Pilot 会先读取上下文再继续。'
      : '选择一个工程，或先描述你想完成的 PLC 任务。',
  }
})

const prompts = computed<WelcomePrompt[]>(() => {
  if (props.mode === 'stone') {
    return [
      { title: '了解工程接口', description: '查看可用的 STone 能力', prompt: '列出当前 STone 工程可用的接口和工具，并说明各自用途。', icon: IconSparkles },
      { title: '整理控制器代码', description: '读取并总结关键文件', prompt: '读取当前 STone 工程的关键源文件，按模块总结控制器逻辑。', icon: IconCode },
      { title: '检查工程问题', description: '从诊断和编译开始', prompt: '检查当前 STone 工程的结构和潜在问题，给出可验证的修复建议。', icon: IconBrain },
      { title: '查找官方文档', description: '快速定位 API 说明', prompt: '查找与当前任务相关的 CAREL STone 官方 API，并给出可执行示例。', icon: IconFileText },
    ]
  }
  if (props.mode === 'chat') {
    return [
      { title: '解释一段代码', description: '逐步理解实现逻辑', prompt: '请逐步解释这段 Structured Text 代码的作用、输入和输出。', icon: IconCode },
      { title: '分析一个文件', description: '读取 Office 或文本内容', prompt: '请读取我接下来附加的文件，并提炼出关键结论。', icon: IconFileText },
      { title: '整理工作思路', description: '把目标拆成可执行步骤', prompt: '请把这个目标整理成清晰、可执行的步骤，并指出需要确认的地方。', icon: IconBrain },
      { title: '开始一次问答', description: '直接描述你的问题', prompt: '我想请你帮我分析一个问题：', icon: IconMessageCircle },
    ]
  }
  return [
    { title: '概览当前工程', description: '读取 POU 和源文件结构', prompt: '读取当前 CODESYS 工程结构，并总结关键 POU、任务和源文件。', icon: IconFileText },
    { title: '检查控制逻辑', description: '关注周期、互锁和状态机', prompt: '检查当前工程的扫描周期、互锁和状态机，指出潜在的安全风险。', icon: IconBrain },
    { title: '查找一个问题', description: '定位变量和调用关系', prompt: '在当前工程中查找未使用变量、重复逻辑和可能的运行时问题。', icon: IconSparkles },
    { title: '生成 Structured Text', description: '从需求开始设计功能块', prompt: '请根据我的需求设计一个安全的 Structured Text 功能块，先给出方案再等待审批。', icon: IconCode },
  ]
})
</script>

<template>
  <section class="empty-welcome" aria-labelledby="empty-welcome-title">
    <strong class="empty-welcome-brand" aria-label="PLC Pilot"><span>PLC</span><span class="empty-welcome-brand-pilot">Pilot</span></strong>
    <p class="empty-welcome-eyebrow">{{ modeCopy.eyebrow }}</p>
    <h1 id="empty-welcome-title" class="empty-welcome-title">{{ modeCopy.title }}</h1>
    <p class="empty-welcome-description">{{ modeCopy.description }}</p>

    <div class="empty-welcome-prompts" aria-label="推荐问题">
      <button
        v-for="(item, index) in prompts"
        :key="item.title"
        type="button"
        class="empty-welcome-prompt"
        :data-tone="index"
        @click="emit('select', item.prompt)"
      >
        <span class="empty-welcome-prompt-icon"><component :is="item.icon" :size="16" stroke="1.5" /></span>
        <span class="empty-welcome-prompt-copy">
          <strong>{{ item.title }}</strong>
          <small>{{ item.description }}</small>
        </span>
        <span class="empty-welcome-prompt-arrow" aria-hidden="true">↗</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.empty-welcome {
  --conversation-text: #303030;
  --conversation-muted: #737373;
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 36px 24px 84px;
  color: var(--conversation-text, #303030);
  text-align: center;
  animation: empty-welcome-enter 420ms cubic-bezier(.22, 1, .36, 1) both;
}

.empty-welcome-brand {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 24px;
  color: #111;
  font-size: 32px;
  font-weight: 650;
  letter-spacing: -.035em;
  line-height: 1;
}

.empty-welcome-brand-pilot {
  padding: 5px 7px 6px;
  border-radius: 6px;
  background: #f59e0b;
}

.empty-welcome-eyebrow {
  margin: 0 0 8px;
  color: var(--conversation-muted, #757575);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.empty-welcome-title {
  max-width: 620px;
  margin: 0;
  color: var(--conversation-text, #262626);
  font-size: clamp(24px, 3vw, 34px);
  font-weight: 650;
  letter-spacing: -.035em;
  line-height: 1.12;
}

.empty-welcome-description {
  max-width: 520px;
  margin: 12px 0 0;
  color: var(--conversation-muted, #737373);
  font-size: 13px;
  line-height: 1.7;
}

.empty-welcome-prompts {
  display: grid;
  width: min(100%, 600px);
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 44px;
  text-align: left;
}

.empty-welcome-prompt {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
  min-height: 82px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--conversation-text, #303030) 11%, transparent);
  border-radius: 10px;
  color: inherit;
  background: color-mix(in srgb, var(--conversation-text, #303030) 2.5%, transparent);
  cursor: pointer;
  text-align: left;
  transition: transform 180ms ease, border-color 180ms ease, background-color 180ms ease, box-shadow 180ms ease;
}

.empty-welcome-prompt[data-tone='0'] { --prompt-color: #2563ad; }
.empty-welcome-prompt[data-tone='1'] { --prompt-color: #258064; }
.empty-welcome-prompt[data-tone='2'] { --prompt-color: #a26315; }
.empty-welcome-prompt[data-tone='3'] { --prompt-color: #8254a8; }

.empty-welcome-prompt:hover {
  border-color: color-mix(in srgb, var(--prompt-color) 40%, transparent);
  background: color-mix(in srgb, var(--prompt-color) 5%, transparent);
  box-shadow: 0 8px 18px rgba(0, 0, 0, .05);
  transform: translateY(-2px);
}

.empty-welcome-prompt:focus-visible {
  outline: 2px solid var(--prompt-color);
  outline-offset: 2px;
}

.empty-welcome-prompt-icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
  border-radius: 8px;
  color: var(--prompt-color);
  background: color-mix(in srgb, currentColor 5%, transparent);
}

.empty-welcome-prompt-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.empty-welcome-prompt-copy strong {
  overflow: hidden;
  color: var(--prompt-color);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-welcome-prompt-copy small {
  overflow: hidden;
  color: var(--conversation-muted, #818181);
  font-size: 10px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-welcome-prompt-arrow {
  align-self: flex-start;
  color: var(--conversation-muted, #909090);
  font-size: 15px;
  line-height: 1;
  opacity: .7;
  transition: color 180ms ease, transform 180ms ease;
}

.empty-welcome-prompt:hover .empty-welcome-prompt-arrow {
  color: var(--prompt-color);
  transform: translate(2px, -2px);
}

@keyframes empty-welcome-enter {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 680px) {
  .empty-welcome { justify-content: flex-start; overflow-y: auto; padding: 24px 16px; }
  .empty-welcome-prompts { grid-template-columns: 1fr; max-width: 420px; }
}

@media (max-height: 720px) and (min-width: 681px) {
  .empty-welcome { padding-block: 18px; overflow-y: auto; }
  .empty-welcome-prompts { margin-top: 28px; }
}

@media (prefers-reduced-motion: reduce) {
  .empty-welcome, .empty-welcome-prompt { animation: none; transition: none; }
}

:global(.dark .empty-welcome) { --conversation-text: #e5e5e5; --conversation-muted: #a3a3a3; }
:global(.dark .empty-welcome-brand) { color: #fff; }
:global(.dark .empty-welcome-prompt[data-tone='0']) { --prompt-color: #8bbafa; }
:global(.dark .empty-welcome-prompt[data-tone='1']) { --prompt-color: #7ec7ae; }
:global(.dark .empty-welcome-prompt[data-tone='2']) { --prompt-color: #e2b877; }
:global(.dark .empty-welcome-prompt[data-tone='3']) { --prompt-color: #c1a1e4; }

:global(.dark .empty-welcome-prompt:hover) {
  box-shadow: 0 10px 22px rgba(0, 0, 0, .24);
}
</style>
