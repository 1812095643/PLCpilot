export type LinkTarget =
  | { kind: 'file'; path: string; href: string }
  | { kind: 'web'; href: string }
  | { kind: 'other'; href: string }

/**
 * 按链接协议和本地路由分类，供菜单及动作共用。不能按扩展名猜测：下载网址可能
 * 以 .exe/.zip 结尾，本地文件也可能是 .html。外站伪造本地路由仍只是网页。
 */
export function classifyLinkTarget(href: string, baseHref: string): LinkTarget {
  const value = href.trim()
  const other: LinkTarget = { kind: 'other', href: value }
  if (!value || value === '#' || /[\u0000-\u001f]/u.test(value)) return other
  if (/^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\')) {
    return { kind: 'file', path: value, href: value }
  }
  try {
    const base = new URL(baseHref)
    const url = new URL(value, base)
    const sameApp = url.origin === base.origin && url.protocol === base.protocol && url.host === base.host
    const browsePrefix = '/codex-local-browse/'
    if (sameApp && url.pathname.startsWith(browsePrefix)) {
      const path = decodeURIComponent(url.pathname.slice(browsePrefix.length - 1)).replace(/^\/([A-Za-z]:[\\/])/u, '$1')
      if (path && !/[\u0000-\u001f]/u.test(path)) return { kind: 'file', path, href: value }
      return other
    }
    if (url.protocol === 'file:' && !url.username && !url.password) {
      const path = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:[\\/])/u, '$1')
      if (!path || /[\u0000-\u001f]/u.test(path)) return other
      return { kind: 'file', path: url.hostname && url.hostname !== 'localhost' ? `//${url.hostname}${path}` : path, href: value }
    }
    // 应用自己的会话导航不是外部网页，不给它错误的“在浏览器中打开”。
    if (sameApp && url.hash.startsWith('#/thread/')) return other
    if (url.protocol === 'http:' || url.protocol === 'https:') return { kind: 'web', href: url.href }
    return other
  } catch { return other }
}
