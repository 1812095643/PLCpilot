import catalog from './image-model-capabilities.json' with { type: 'json' }

export function officialImageParameters(model) {
  const name = String(model).split('/').at(-1).toLowerCase()
  const newer = /^gpt-image-2\.5-(sunburst|flare)(?:-|$)/u.test(name)
  const flexible = newer || /^gpt-image-2(?:-|$)/u.test(name)
  if (!flexible && !/^gpt-image-1/u.test(name) && name !== 'chatgpt-image-latest') return null
  return {
    source: catalog.source,
    sizes: flexible ? catalog.flexible.sizes : catalog.standard.sizes,
    qualities: newer ? catalog.quality_2_5 : catalog.standard.qualities,
    custom_size: flexible ? catalog.flexible.constraints : null,
  }
}

export function imageParameters(model, metadata) {
  return officialImageParameters(model) ?? (metadata?.source === 'provider' ? metadata : null)
    ?? { source: '', sizes: ['auto'], qualities: ['auto'], custom_size: null }
}

export function validImageSize(size, parameters) {
  if (parameters.sizes.includes(size)) return true
  const rule = parameters.custom_size
  const match = /^(\d+)x(\d+)$/u.exec(size)
  if (!rule || !match) return false
  const width = Number(match[1]), height = Number(match[2])
  return width > 0 && height > 0 && width <= rule.max_edge && height <= rule.max_edge
    && width % rule.multiple === 0 && height % rule.multiple === 0
    && Math.max(width, height) <= Math.min(width, height) * rule.max_ratio
    && width * height >= rule.min_pixels && width * height <= rule.max_pixels
}

export function imageQualityLabel(value) {
  return ({ auto: '自动', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高' })[value] ?? value
}

export function imageSizeLabel(value) {
  return value === 'auto' ? '自动尺寸' : value.replace('x', ' × ')
}
