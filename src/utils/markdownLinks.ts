/** 保留含空格、中文、括号的本地文件链接，不把路径当作 Markdown 的结束符。 */
export function nextMarkdownLink(source: string, fromIndex: number): { start: number; end: number; token: string } | null {
  for (let start = source.indexOf('[', fromIndex); start >= 0; start = source.indexOf('[', start + 1)) {
    if (start > 0 && source[start - 1] === '\\') continue
    let labelEnd = start + 1
    for (; labelEnd < source.length; labelEnd++) {
      if (source[labelEnd] === '\\') { labelEnd++; continue }
      if (source[labelEnd] === ']' || source[labelEnd] === '\n') break
    }
    if (source[labelEnd] !== ']' || source[labelEnd + 1] !== '(') continue
    let depth = 1
    let angle = false
    for (let i = labelEnd + 2; i < source.length && source[i] !== '\n'; i++) {
      const char = source[i]
      if (char === '<' && !source.slice(labelEnd + 2, i).trim()) angle = true
      else if (char === '>' && angle) angle = false
      else if (!angle && char === '(') depth++
      else if (!angle && char === ')' && --depth === 0) {
        return { start, end: i + 1, token: source.slice(start, i + 1) }
      }
    }
  }
  return null
}

export function parseMarkdownLink(value: string): { label: string; target: string } | null {
  const text = value.trim()
  const match = nextMarkdownLink(text, 0)
  if (!match || match.start || match.end !== text.length) return null
  let labelEnd = 1
  while (labelEnd < text.length) {
    if (text[labelEnd] === '\\') { labelEnd += 2; continue }
    if (text[labelEnd] === ']') break
    labelEnd++
  }
  const label = text.slice(1, labelEnd).replace(/\\([\\\[\]])/gu, '$1').trim()
  const target = text.slice(labelEnd + 2, -1).trim()
  return label && target ? { label, target } : null
}
