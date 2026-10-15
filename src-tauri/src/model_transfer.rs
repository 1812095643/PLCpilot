//! 模型用途转换只移动配置；原对话参数随生图配置保存，凭据继续归服务商管理。
use super::*;
use crate::image_generation::{ImageModel, ImageSettings};

#[derive(Serialize)]
pub struct ModelTransferResult {
    images: ImageSettings,
    models: Vec<ModelSummary>,
    model: ModelSummary,
    active_model_id: String,
}

fn repair_default(images: &mut ImageSettings) {
    if !images.models.iter().any(|model| model.id == images.default_id && model.enabled) {
        images.default_id = images.models.iter().find(|model| model.enabled).map(|model| model.id.clone()).unwrap_or_default();
    }
}

fn to_image(runtime: &mut RuntimeState, images: &mut ImageSettings, id: &str) -> Result<(), AppError> {
    let Some(source) = runtime.models.iter().find(|model| model.id == id).cloned() else {
        if images.models.iter().any(|model| model.chat_profile.as_ref().is_some_and(|profile| profile.id == id)) { return Ok(()); }
        return Err(AppError::Configuration("对话模型已不存在，请刷新模型设置。".into()));
    };
    if source.model.len() > 200 { return Err(AppError::Configuration("生图模型 ID 不能超过 200 字节。".into())); }
    if !runtime.model_providers.iter().any(|provider| provider.id == source.provider_id) { return Err(AppError::Configuration("此模型的服务商已不存在。".into())); }
    let existing = images.models.iter().position(|model| model.provider_id == source.provider_id && model.model == source.model);
    if existing.is_none() && images.models.len() >= 64 { return Err(AppError::Configuration("生图模型最多配置 64 个。".into())); }
    if existing.is_some_and(|index| images.models[index].chat_profile.as_ref().is_some_and(|profile| profile.id != id)) {
        return Err(AppError::Configuration("此服务商的同名模型已设为生图，请先将已有配置转回对话模型。".into()));
    }
    let mut profile = source.clone();
    profile.api_key = None;
    if let Some(index) = existing {
        // 兼容此前已在两边添加过同一模型的配置，保留原生图参数与历史记录中的 ID。
        images.models[index].chat_profile = Some(profile);
        images.models[index].name = Some(source.name.clone());
    } else {
        let caps = image_parameters::for_model(&source.model, source.image_parameters.as_ref());
        images.models.push(ImageModel {
            id: source.id.clone(), provider_id: source.provider_id.clone(), model: source.model.clone(), name: Some(source.name.clone()),
            protocol: "images".into(), request_model: None, size: caps.sizes.first().cloned().unwrap_or_else(|| "auto".into()),
            quality: caps.qualities.first().cloned().unwrap_or_else(|| "auto".into()), streaming: false,
            enabled: source.enabled, parameters: Some(caps), chat_profile: Some(profile),
        });
    }
    runtime.models.retain(|model| model.id != id);
    sync_active_model(runtime);
    repair_default(images);
    Ok(())
}

fn to_chat(runtime: &mut RuntimeState, images: &mut ImageSettings, id: &str) -> Result<(), AppError> {
    let Some(index) = images.models.iter().position(|model| model.id == id) else {
        if runtime.models.iter().any(|model| model.id == id) { return Ok(()); }
        return Err(AppError::Configuration("生图模型已不存在，请刷新模型设置。".into()));
    };
    let image = &images.models[index];
    let mut profile = image.chat_profile.clone().unwrap_or_else(|| ModelConfig {
        id: image.id.clone(), name: image.name.clone().unwrap_or_else(|| image.model.clone()), model: image.model.clone(),
        provider_id: image.provider_id.clone(), is_default: false, ..ModelConfig::default()
    });
    profile.api_key = None;
    profile.enabled = image.enabled;
    profile.is_default = false;
    profile.image_parameters = image.parameters.clone();
    model_providers::bind_model(runtime, &mut profile)?;
    let existing = runtime.models.iter().position(|model| model.id == profile.id)
        .or_else(|| if image.chat_profile.is_none() { runtime.models.iter().position(|model| model.provider_id == image.provider_id && model.model == image.model) } else { None });
    if let Some(index) = existing {
        // 旧版生图模型没有原 profile，沿用已有对话配置，避免覆盖用户调整过的上下文。
        if image.chat_profile.is_some() { runtime.models[index] = profile; }
        else { runtime.models[index].enabled = image.enabled; }
    } else { runtime.models.push(profile); }
    images.models.remove(index);
    sync_active_model(runtime);
    repair_default(images);
    Ok(())
}

fn persist_transfer(previous: &RuntimeState, next: &RuntimeState, old_images: &ImageSettings, images: &ImageSettings, to_images: bool) -> Result<(), AppError> {
    // 先写入接收端，再移除来源端；中途异常保留可恢复配置，不让模型丢失。
    if to_images {
        image_generation::write_settings(images)?;
        if let Err(error) = persist_runtime_state(next) {
            if persist_runtime_state(previous).is_ok() {
                image_generation::write_settings(old_images)?;
            }
            return Err(error);
        }
    } else {
        persist_runtime_state(next)?;
        if let Err(error) = image_generation::write_settings(images) {
            let _ = persist_runtime_state(previous);
            return Err(error);
        }
    }
    Ok(())
}

async fn transfer(id: String, state: &AppState, to_images: bool) -> Result<ModelTransferResult, AppError> {
    let mut guard = state.inner.lock().await;
    let mut next = guard.clone();
    let previous_images = image_generation::read_settings()?;
    let mut images = previous_images.clone();
    if to_images { to_image(&mut next, &mut images, &id)?; } else { to_chat(&mut next, &mut images, &id)?; }
    persist_transfer(&guard, &next, &previous_images, &images, to_images)?;
    let result = ModelTransferResult { images: image_generation::public_settings(images),
        models: model_summaries(&next.models), model: model_summary(&next.model), active_model_id: next.active_model_id.clone() };
    *guard = next;
    Ok(result)
}

#[tauri::command]
pub async fn move_model_to_image(id: String, state: State<'_, AppState>) -> Result<ModelTransferResult, AppError> { transfer(id, &state, true).await }
#[tauri::command]
pub async fn move_model_to_chat(id: String, state: State<'_, AppState>) -> Result<ModelTransferResult, AppError> { transfer(id, &state, false).await }

#[cfg(test)]
mod tests {
    use super::*;
    fn runtime() -> RuntimeState {
        let mut state = RuntimeState { models: vec![ModelConfig { id: "custom".into(), name: "自定义名称".into(),
            base_url: "https://local.example/v1".into(), model: "gpt-image-2".into(), api_key: Some("test-provider-secret".into()),
            context_window: 256000, max_tokens: 8192, reasoning_levels: vec!["none".into(), "high".into()], ..ModelConfig::default() }], ..RuntimeState::default() };
        sync_active_model(&mut state);
        state
    }
    #[test]
    fn moving_last_model_and_restoring_preserves_profile_without_plaintext_credentials() {
        let mut state = runtime();
        let provider_id = state.models[0].provider_id.clone();
        let mut images = ImageSettings::default();
        to_image(&mut state, &mut images, "custom").unwrap();
        assert!(state.models.is_empty());
        assert!(state.active_model_id.is_empty());
        assert!(!state.model.enabled);
        assert_eq!(images.default_id, "custom");
        let serialized = serde_json::to_string(&images).unwrap();
        assert!(!serialized.contains("test-provider-secret"));
        images = serde_json::from_str(&serialized).unwrap();
        assert!(image_generation::public_settings(images.clone()).models[0].chat_profile.is_none());
        to_chat(&mut state, &mut images, "custom").unwrap();
        assert!(images.models.is_empty());
        let restored = &state.models[0];
        assert_eq!(restored.provider_id, provider_id);
        assert_eq!(restored.name, "自定义名称");
        assert_eq!(restored.context_window, 256000);
        assert_eq!(restored.max_tokens, 8192);
        assert_eq!(restored.reasoning_levels, vec!["none", "high"]);
        assert_eq!(restored.api_key.as_deref(), Some("test-provider-secret"));
    }
    #[test]
    fn legacy_images_merge_with_existing_chat_profiles_without_duplicates() {
        let mut state = runtime();
        let mut images = ImageSettings { default_id: "legacy".into(), models: vec![ImageModel {
            id: "legacy".into(), provider_id: state.models[0].provider_id.clone(), model: "gpt-image-2".into(), name: None,
            protocol: "images".into(), request_model: None, size: "1536x864".into(), quality: "high".into(),
            streaming: true, enabled: true, parameters: None, chat_profile: None,
        }] };
        to_image(&mut state, &mut images, "custom").unwrap();
        to_image(&mut state, &mut images, "custom").unwrap();
        assert_eq!(images.models.len(), 1);
        assert_eq!(images.models[0].size, "1536x864");
        assert_eq!(images.default_id, "legacy");
        to_chat(&mut state, &mut images, "legacy").unwrap();
        assert_eq!(state.models.len(), 1);
        assert_eq!(state.models[0].id, "custom");
        assert_eq!(state.models[0].context_window, 256000);
    }
    #[test]
    fn active_chat_model_falls_back_and_identical_names_in_other_providers_are_untouched() {
        let mut state = runtime();
        state.models.push(ModelConfig { id: "other".into(), base_url: "https://other.example/v1".into(), model: "gpt-image-2".into(), ..ModelConfig::default() });
        sync_active_model(&mut state);
        let mut images = ImageSettings::default();
        to_image(&mut state, &mut images, "custom").unwrap();
        assert_eq!(state.active_model_id, "other");
        assert_eq!(state.models.len(), 1);
        to_chat(&mut state, &mut images, "custom").unwrap();
        assert_eq!(state.active_model_id, "other");
        assert_eq!(state.models.len(), 2);
    }
}
