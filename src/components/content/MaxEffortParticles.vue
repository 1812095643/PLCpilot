<script setup lang="ts">
const particles = Array.from({ length: 20 }, (_, index) => ({
  id: index,
  style: {
    '--particle-duration': `${1700 + (index % 5) * 190}ms`,
    '--particle-delay': `${-index * 173}ms`,
    '--particle-spread': `${((index * 7) % 21) - 10}px`,
    '--particle-size': `${1.2 + (index % 3) * 0.4}px`,
    '--particle-length': `${2 + (index % 4) * 0.8}px`,
    '--particle-color': ['#ead5ff', '#c5a0fc', '#995ee8', '#dcb9ff'][index % 4],
  },
}))
</script>

<template>
  <span class="max-effort-particles" aria-hidden="true">
    <span v-for="particle in particles" :key="particle.id" class="max-effort-particle" :style="particle.style" />
  </span>
</template>

<style scoped>
.max-effort-particles { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; pointer-events: none; contain: strict; }
.max-effort-particle { position: absolute; inset: 0; animation: max-effort-jet var(--particle-duration) var(--particle-delay) linear infinite; }
.max-effort-particle::after {
  content: ''; position: absolute; right: calc(var(--effort-thumb-size) / 2); top: 50%;
  width: var(--particle-length); height: var(--particle-size); border-radius: 1px;
  background: var(--particle-color);
}
/* 发射点固定在最右侧圆形滑块内缘，向左散开；只用 transform/opacity，不挤动轨道。 */
@keyframes max-effort-jet {
  0% { transform: translate(0, 0); opacity: 0; }
  10% { opacity: 0.95; }
  65% { opacity: 0.65; }
  100% { transform: translate(-100%, var(--particle-spread)); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .max-effort-particles { display: none; }
  .max-effort-particle { animation: none; }
}
</style>
