import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { invoke, isTauri } from '@tauri-apps/api/core'

// 测试阶段异常只写本机日志，不增加页面入口或弹窗；日志调用自身的异常不能递归上报。
function recordError(event: string, reason: unknown, detail = ''): void {
  if (!isTauri()) return
  const error = reason instanceof Error ? { message: reason.message, stack: reason.stack } : { message: String(reason) }
  void invoke('record_frontend_diagnostic', { event, details: { ...error, detail } }).catch(() => {})
}
window.addEventListener('error', event => recordError('window.error', event.error ?? event.message, `${event.filename}:${event.lineno}`))
window.addEventListener('unhandledrejection', event => recordError('window.unhandledrejection', event.reason))
const app = createApp(App)
app.config.errorHandler = (error, _instance, detail) => { console.error(error); recordError('vue.error', error, detail) }
app.mount('#app')
