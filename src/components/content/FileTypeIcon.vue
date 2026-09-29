<script setup lang="ts">
import { computed } from 'vue'
import { IconFile, IconFileCode, IconFileText, IconPhoto, IconTable, IconFileZip } from '@tabler/icons-vue'
import excel from '../../assets/file-icons/file_type_excel.svg'
import word from '../../assets/file-icons/file_type_word.svg'
import powerpoint from '../../assets/file-icons/file_type_powerpoint.svg'
import pdf from '../../assets/file-icons/file_type_pdf.svg'

const props = defineProps<{ name: string; mimeType?: string }>()
const type = computed(() => {
  const extension = props.name.split('.').pop()?.toLowerCase() || ''
  if (['xlsx', 'xls', 'xlsm', 'xlsb', 'xltx', 'xltm'].includes(extension)) return { image: excel, label: 'Excel' }
  if (['doc', 'docx', 'docm', 'dotx', 'dotm'].includes(extension)) return { image: word, label: 'Word' }
  if (['ppt', 'pptx', 'pptm', 'potx', 'ppsx'].includes(extension)) return { image: powerpoint, label: 'PowerPoint' }
  if (extension === 'pdf' || props.mimeType === 'application/pdf') return { image: pdf, label: 'PDF' }
  if (['csv', 'tsv', 'ods'].includes(extension)) return { icon: IconTable, label: '表格' }
  if (props.mimeType?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(extension)) return { icon: IconPhoto, label: '图片' }
  if (['zip', '7z', 'rar', 'gz', 'tar'].includes(extension)) return { icon: IconFileZip, label: '压缩包' }
  if (['js', 'ts', 'py', 'rs', 'st', 'cs', 'c', 'cpp', 'html', 'htm', 'css', 'json', 'vue', 'xml', 'yaml', 'yml'].includes(extension)) return { icon: IconFileCode, label: '代码' }
  if (props.mimeType?.startsWith('text/') || ['txt', 'md', 'log', 'rtf'].includes(extension)) return { icon: IconFileText, label: '文本' }
  return { icon: IconFile, label: '文件' }
})
</script>

<template>
  <span class="file-type-icon" :data-file-type="type.label" aria-hidden="true">
    <img v-if="type.image" :src="type.image" alt="" draggable="false" />
    <component :is="type.icon" v-else :stroke-width="1.6" />
  </span>
</template>

<style scoped>
.file-type-icon { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; flex: 0 0 auto; }
.file-type-icon img, .file-type-icon :deep(svg) { display: block; width: 100%; height: 100%; object-fit: contain; }
</style>
