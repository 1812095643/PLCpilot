export type ImageSizeConstraints = {
  multiple: number; max_edge: number; min_pixels: number; max_pixels: number; max_ratio: number; experimental_above_pixels: number
}
export type ImageCapabilities = { source: string; sizes: string[]; qualities: string[]; custom_size?: ImageSizeConstraints | null }
export function officialImageParameters(model: string): ImageCapabilities | null
export function imageParameters(model: string, metadata?: ImageCapabilities | null): ImageCapabilities
export function validImageSize(size: string, parameters: ImageCapabilities): boolean
export function imageQualityLabel(value: string): string
export function imageSizeLabel(value: string): string
