<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'

const props = defineProps<{ ready: boolean }>()
const emit = defineEmits<{ finished: [] }>()

const visible = shallowRef(true)
const introFinished = shallowRef(false)
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
let introTimer: number | undefined
let deadlineTimer: number | undefined

function finishIntro(): void {
  window.clearTimeout(introTimer)
  introFinished.value = true
}

function onBrandRevealed(): void {
  window.clearTimeout(introTimer)
  // 完整字标播放结束后停留 0.5 秒，再让出已就绪的工作台；不串行阻塞初始化。
  introTimer = window.setTimeout(finishIntro, 500)
}

function onMotionPreferenceChange(): void {
  if (motionPreference.matches) finishIntro()
}

watch(() => props.ready && introFinished.value, (ready) => {
  if (ready) visible.value = false
})

onMounted(() => {
  motionPreference.addEventListener('change', onMotionPreferenceChange)
  if (motionPreference.matches) finishIntro()
  // 动画事件被系统禁用、窗口不可见或初始化挂起时，也不能永久遮住界面。
  else introTimer = window.setTimeout(finishIntro, 3600)
  deadlineTimer = window.setTimeout(() => { visible.value = false }, 8000)
})

onBeforeUnmount(() => {
  window.clearTimeout(introTimer)
  window.clearTimeout(deadlineTimer)
  motionPreference.removeEventListener('change', onMotionPreferenceChange)
})
</script>

<template>
  <Transition name="startup" @after-leave="emit('finished')">
    <div v-if="visible" class="app-splash" role="status" aria-label="正在启动 PLC Pilot" :aria-busy="!ready">
      <div class="splash-center">
        <div class="splash-wordmark" aria-hidden="true">
          <span class="splash-plc">
            <span v-for="(letter, index) in ['P', 'L', 'C']" :key="letter" class="splash-letter" :style="{ '--letter-index': index }">
              <span class="splash-letter-glyph">{{ letter }}</span>
            </span>
          </span>
          <span class="splash-pilot-mask" @animationend.self="onBrandRevealed">
            <span class="splash-pilot">Pilot</span>
          </span>
        </div>
        <span v-if="!ready" class="splash-waiting" aria-hidden="true">正在打开工作区<span class="splash-dots"><i /><i /><i /></span></span>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.app-splash {
  /* 阻尼弹簧曲线的预采样值：速度随位移变化，回弹幅度自然衰减；无需逐帧运行 JS。 */
  --spring-drop: linear(
    0, 0.0518, 0.187, 0.3743, 0.584, 0.7904, 0.9736, 1.1203, 1.2238, 1.2829,
    1.3012, 1.2856, 1.2449, 1.1885, 1.1253, 1.0631, 1.008, 0.9638, 0.9326, 0.9148,
    0.9093, 0.914, 0.9262, 0.9432, 0.9623, 0.981, 0.9976, 1.0109, 1.0203, 1.0257,
    1.0273, 1.0259, 1.0222, 1.0171, 1.0114, 1.0057, 1.0007, 0.9967, 0.9939, 0.9923, 1
  );
  --spring-settle: linear(
    0, 0.0578, 0.1967, 0.373, 0.5544, 0.7196, 0.8564, 0.9603, 1.0316, 1.0743,
    1.0938, 1.0963, 1.0875, 1.0724, 1.0549, 1.0376, 1.0224, 1.0102, 1.0012, 0.9953,
    0.9919, 0.9907, 0.9909, 0.992, 0.9935, 0.9953, 0.9969, 0.9983, 0.9993, 1.0001,
    1.0006, 1.0008, 1
  );
  position: fixed;
  inset: 34px 0 0;
  z-index: 800;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: #fff;
  color: #111;
  user-select: none;
}

.splash-center { position: relative; }

.splash-wordmark {
  --pilot-width: 2.65em;
  --brand-gap: 0.16em;
  display: flex;
  align-items: center;
  gap: var(--brand-gap);
  font-size: clamp(40px, 4.8vw, 54px);
  font-weight: 650;
  letter-spacing: -0.025em;
  line-height: 1;
  animation: wordmark-center 840ms 1760ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.splash-plc { display: inline-flex; }

.splash-letter {
  --letter-delay: calc(120ms + var(--letter-index) * 180ms);
  display: inline-block;
  transform-origin: 50% 100%;
  animation:
    letter-land 1280ms var(--letter-delay) cubic-bezier(0.2, 1.35, 0.3, 1) both,
    letter-appear 400ms var(--letter-delay) ease-out both;
}

.splash-letter-glyph {
  display: inline-block;
  transform-origin: 50% 100%;
  animation: letter-squash 1280ms var(--letter-delay) cubic-bezier(0.37, 0, 0.63, 1) both;
}

.splash-pilot-mask {
  display: block;
  width: var(--pilot-width);
  overflow: hidden;
  border-radius: 0.16em;
  animation: pilot-unfold 840ms 1760ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.splash-pilot {
  display: block;
  padding: 0.15em 0.18em 0.18em;
  border-radius: inherit;
  background: #f59e0b;
  text-align: center;
  animation: pilot-unfold-text 840ms 1760ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.splash-waiting {
  position: absolute;
  top: calc(100% + 26px);
  left: 0;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: #757575;
  font-size: 12px;
  letter-spacing: 0.04em;
  animation: waiting-appear 480ms 3000ms both;
}

.splash-dots { display: inline-flex; gap: 3px; }
.splash-dots i { width: 3px; height: 3px; border-radius: 50%; background: currentColor; animation: waiting-dot 2800ms infinite ease-in-out; }
.splash-dots i:nth-child(2) { animation-delay: 320ms; }
.splash-dots i:nth-child(3) { animation-delay: 640ms; }

/* 位移、字形和透明度分别动画，避免形变影响弹跳高度或让文字随回弹闪烁。 */
@keyframes letter-land {
  from { transform: translateY(-26px); }
  to { transform: translateY(0); }
}

/* 形变峰值与弹簧曲线的最低点、回弹最高点对齐，并随振幅一起衰减。 */
@keyframes letter-squash {
  0% { transform: scale(0.99, 1.02); }
  16%, 40%, 65%, 90%, 100% { transform: scale(1); }
  25% { transform: scale(1.055, 0.92); }
  50% { transform: scale(0.979, 1.038); }
  75% { transform: scale(1.017, 0.977); }
  96% { transform: scale(0.997, 1.006); }
}

@keyframes letter-appear { from { opacity: 0; } to { opacity: 1; } }

@supports (animation-timing-function: linear(0, 1)) {
  .splash-letter { animation-timing-function: var(--spring-drop), ease-out; }
  .splash-wordmark { animation-timing-function: var(--spring-settle); }
}

@keyframes wordmark-center {
  from { transform: translateX(calc((var(--pilot-width) + var(--brand-gap)) / 2)); }
  to { transform: translateX(0); }
}

/* 外层裁切与文字反向移动，向右展开底纹时保持字形比例。 */
@keyframes pilot-unfold { from { transform: translateX(-100%); } to { transform: translateX(0); } }
@keyframes pilot-unfold-text { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes waiting-appear { from { opacity: 0; } to { opacity: 1; } }
@keyframes waiting-dot { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }

.startup-leave-active { transition: opacity 440ms cubic-bezier(0.25, 1, 0.5, 1); }
.startup-leave-to { opacity: 0; }

:global(.dark .app-splash) { background: #1e1e1e; color: #fff; }
:global(.dark .splash-waiting) { color: #999; }

@media (prefers-reduced-motion: reduce) {
  .splash-wordmark, .splash-letter, .splash-letter-glyph, .splash-pilot-mask, .splash-pilot, .splash-waiting, .splash-dots i { animation: none; }
  .startup-leave-active { transition-duration: 80ms; }
}
</style>
