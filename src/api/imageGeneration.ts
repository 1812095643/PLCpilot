import { invoke } from '@tauri-apps/api/core'
import type { ImageCapabilities } from '../../shared/image-model-parameters.mjs'
export type { ImageCapabilities } from '../../shared/image-model-parameters.mjs'
export type ImageModel = { id: string; provider_id: string; model: string; protocol: 'images' | 'responses'; request_model?: string; size: string; quality: string; streaming: boolean; enabled: boolean; parameters?: ImageCapabilities | null }
export type ImageSettings = { models: ImageModel[]; default_id: string }
export type ImageGenerationProgress = {
  id: string; scope: string; status: 'generating' | 'partial' | 'completed' | 'cancelled' | 'error'; model: string
  model_id?: string; provider_id?: string; prompt?: string; size?: string; quality?: string; started_at?: string
  finished_at?: string | null; duration_ms?: number; referenced_image_paths?: string[]; width?: number | null; height?: number | null
  thumbnail_url?: string | null; image_url?: string; path?: string; error?: string
}
export type ImageStudioRequest = { prompt: string; model_id: string; size: string; quality: string; referenced_image_paths: string[] }
export const getImageSettings = () => invoke<ImageSettings>('get_image_settings')
export const saveImageSettings = (settings: ImageSettings) => invoke<ImageSettings>('save_image_settings', { settings })
export const getImageStudioHistory = () => invoke<ImageGenerationProgress[]>('get_image_studio_history')
export const startImageStudioGeneration = (request: ImageStudioRequest) => invoke<ImageGenerationProgress>('start_image_studio_generation', { request })
export const cancelImageStudioGeneration = (id: string) => invoke<void>('cancel_image_studio_generation', { id })
export const saveImageStudioResult = (id: string) => invoke<string | null>('save_image_studio_result', { id })
