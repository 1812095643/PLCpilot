import { invoke } from '@tauri-apps/api/core'
export type ImageModel = { id: string; provider_id: string; model: string; protocol: 'images' | 'responses'; request_model?: string; size: string; quality: string; streaming: boolean; enabled: boolean }
export type ImageSettings = { models: ImageModel[]; default_id: string }
export type ImageGenerationProgress = { id: string; scope: string; status: 'generating' | 'partial' | 'completed' | 'cancelled' | 'error'; model: string; image_url?: string; path?: string; error?: string }
export const getImageSettings = () => invoke<ImageSettings>('get_image_settings')
export const saveImageSettings = (settings: ImageSettings) => invoke<ImageSettings>('save_image_settings', { settings })
