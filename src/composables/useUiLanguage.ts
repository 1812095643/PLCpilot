import { shallowRef } from 'vue'

export type UiLanguage = 'en' | 'zh-CN'

const UI_LANGUAGE_STORAGE_KEY = 'plc-pilot.ui-language.v1'

// 当前桌面包只需要工作台基础控件的双语文案；Codex Web 的账户、Git、自动化等词条不随包发布。
const zhCN: Record<string, string> = {
  'Expand sidebar': '展开侧边栏',
  'Collapse sidebar': '折叠侧边栏',
  'Start new thread': '新建会话',
  'No results': '没有结果',
  'Select...': '选择…',
  selected: '已选',
}

const LANGUAGE_LABELS: Record<UiLanguage, string> = {
  en: 'English',
  'zh-CN': '简体中文',
}

function readStoredLanguage(): UiLanguage {
  if (typeof window === 'undefined') return 'en'
  try {
    return window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)?.trim() === 'zh-CN' ? 'zh-CN' : 'en'
  } catch {
    return 'en'
  }
}

const currentLanguage = shallowRef<UiLanguage>(readStoredLanguage())

function applyDocumentLanguage(language: UiLanguage): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language
  document.documentElement.dataset.uiLanguage = language
}

applyDocumentLanguage(currentLanguage.value)

function formatTemplate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(params[key] ?? ''))
}

export function setUiLanguage(language: UiLanguage): void {
  currentLanguage.value = language
  applyDocumentLanguage(language)
  try {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, language)
  } catch {
    // 桌面运行时禁用本地存储时仍保留当前窗口语言。
  }
}

export function t(message: string, params?: Record<string, string | number>): string {
  const translated = currentLanguage.value === 'zh-CN' ? (zhCN[message] ?? message) : message
  return formatTemplate(translated, params)
}

export function useUiLanguage() {
  return {
    uiLanguage: currentLanguage,
    uiLanguageOptions: [
      { value: 'en', label: LANGUAGE_LABELS.en },
      { value: 'zh-CN', label: LANGUAGE_LABELS['zh-CN'] },
    ] as Array<{ value: UiLanguage; label: string }>,
    t,
    setUiLanguage,
  }
}
