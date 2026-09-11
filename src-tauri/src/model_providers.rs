use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProvider {
    #[serde(default)] pub id: String,
    pub name: String,
    pub provider: ProviderKind,
    pub base_url: String,
    #[serde(default)] pub api_key: Option<String>,
    #[serde(default = "default_model_enabled")] pub enabled: bool,
}

fn url_key(url: &str) -> String {
    reqwest::Url::parse(url.trim()).map(|url| url.to_string().trim_end_matches('/').to_string())
        .unwrap_or_else(|_| url.trim().trim_end_matches('/').to_string())
}

pub fn summary(provider: &ModelProvider) -> Value {
    json!({"id": provider.id, "name": provider.name, "provider": provider.provider, "base_url": provider.base_url,
        "enabled": provider.enabled, "api_key_configured": provider.api_key.as_ref().is_some_and(|key| !key.is_empty())})
}

/// 旧版仅保存模型，服务商是临时 URL 分组，空服务商无法存在。升级时按 URL 建立
/// 稳定服务商 ID，保留模型 ID 和独立勾选；运行时只投影共享连接与服务商启用状态。
pub fn sync_models(state: &mut RuntimeState) {
    for model in &mut state.models {
        let index = state.model_providers.iter().position(|provider| !model.provider_id.is_empty() && provider.id == model.provider_id)
            .or_else(|| state.model_providers.iter().position(|provider| url_key(&provider.base_url) == url_key(&model.base_url)));
        let index = index.unwrap_or_else(|| {
            let name = reqwest::Url::parse(&model.base_url).ok().and_then(|url| url.host_str().map(str::to_string)).unwrap_or_else(|| "服务商".into());
            state.model_providers.push(ModelProvider { id: format!("provider-{}", Uuid::new_v4()), name, provider: model.provider.clone(), base_url: url_key(&model.base_url), api_key: model.api_key.clone(), enabled: true });
            state.model_providers.len() - 1
        });
        let provider = &mut state.model_providers[index];
        if provider.api_key.is_none() { provider.api_key = model.api_key.clone(); }
        model.provider_id = provider.id.clone();
        model.provider_name = provider.name.clone();
        model.provider_enabled = provider.enabled;
        model.provider = provider.provider.clone();
        model.base_url = provider.base_url.clone();
        model.api_key = provider.api_key.clone();
    }
}

pub fn bind_model(state: &RuntimeState, model: &mut ModelConfig) -> Result<(), AppError> {
    if model.provider_id.is_empty() { return Ok(()); }
    let provider = state.model_providers.iter().find(|provider| provider.id == model.provider_id)
        .ok_or_else(|| AppError::Configuration("服务商已不存在，请重新选择服务商后添加模型。".into()))?;
    model.provider = provider.provider.clone(); model.base_url = provider.base_url.clone();
    model.api_key = provider.api_key.clone(); model.provider_enabled = provider.enabled; model.provider_name = provider.name.clone();
    Ok(())
}

pub fn upsert(state: &mut RuntimeState, mut provider: ModelProvider) -> Result<ModelProvider, AppError> {
    let url = reqwest::Url::parse(provider.base_url.trim()).map_err(|_| AppError::Configuration("请填写完整服务商 URL，例如 https://api.example.com/v1。".into()))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err(AppError::Configuration("服务商需要 HTTP/HTTPS 地址；认证信息请填写到 API Key。".into()));
    }
    provider.base_url = url_key(url.as_str());
    provider.name = provider.name.trim().to_string();
    if provider.name.is_empty() || provider.name.chars().count() > 80 { return Err(AppError::Configuration("服务商名称请填写 1 到 80 个字符。".into())); }
    if state.model_providers.iter().any(|item| item.id != provider.id && url_key(&item.base_url) == provider.base_url) {
        return Err(AppError::Configuration("这个 URL 已有服务商配置，请在该服务商下添加模型。".into()));
    }
    provider.api_key = provider.api_key.filter(|key| !key.trim().is_empty()).map(|key| key.trim().to_string());
    if provider.id.is_empty() { provider.id = format!("provider-{}", Uuid::new_v4()); }
    else {
        let previous = state.model_providers.iter().find(|item| item.id == provider.id).ok_or_else(|| AppError::Configuration("服务商不存在，请刷新后重试。".into()))?;
        // 空 Key 仅在同一 URL/协议中继承；改到其他服务地址不能携带旧凭据。
        if provider.api_key.is_none() && previous.provider == provider.provider && url_key(&previous.base_url) == provider.base_url { provider.api_key = previous.api_key.clone(); }
    }
    for model in state.models.iter_mut().filter(|model| model.provider_id == provider.id) {
        if model.base_url != provider.base_url || model.provider != provider.provider || model.api_key != provider.api_key { model.last_checked_at = None; model.last_error = None; }
        model.base_url = provider.base_url.clone(); model.provider = provider.provider.clone(); model.api_key = provider.api_key.clone();
    }
    if let Some(existing) = state.model_providers.iter_mut().find(|item| item.id == provider.id) { *existing = provider.clone(); }
    else { state.model_providers.push(provider.clone()); }
    sync_active_model(state);
    Ok(provider)
}

fn provider_model(provider: &ModelProvider) -> ModelConfig {
    ModelConfig { id: String::new(), name: String::new(), model: String::new(), provider_id: provider.id.clone(), provider: provider.provider.clone(),
        base_url: provider.base_url.clone(), api_key: provider.api_key.clone(), is_default: false, ..ModelConfig::default() }
}

#[tauri::command]
pub async fn get_model_providers(state: State<'_, AppState>) -> Result<Vec<Value>, AppError> {
    Ok(state.inner.lock().await.model_providers.iter().map(summary).collect())
}

#[tauri::command]
pub async fn save_model_provider(provider: ModelProvider, state: State<'_, AppState>) -> Result<Value, AppError> {
    let mut guard = state.inner.lock().await;
    let mut next = guard.clone();
    let saved = upsert(&mut next, provider)?;
    persist_runtime_state(&next)?;
    *guard = next;
    Ok(summary(&saved))
}

#[tauri::command]
pub async fn delete_model_provider(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let mut guard = state.inner.lock().await;
    let mut next = guard.clone();
    next.models.retain(|model| model.provider_id != id);
    next.model_providers.retain(|provider| provider.id != id);
    sync_active_model(&mut next);
    persist_runtime_state(&next)?;
    *guard = next;
    Ok(())
}

#[tauri::command]
pub async fn set_model_provider_enabled(id: String, enabled: bool, state: State<'_, AppState>) -> Result<Vec<Value>, AppError> {
    let mut guard = state.inner.lock().await;
    let mut next = guard.clone();
    let provider = next.model_providers.iter_mut().find(|provider| provider.id == id)
        .ok_or_else(|| AppError::Configuration("服务商不存在，请刷新后重试。".into()))?;
    provider.enabled = enabled;
    for model in next.models.iter_mut().filter(|model| model.provider_id == id) { model.provider_enabled = enabled; }
    sync_active_model(&mut next);
    persist_runtime_state(&next)?;
    let providers = next.model_providers.iter().map(summary).collect();
    *guard = next;
    Ok(providers)
}

#[tauri::command]
pub async fn discover_provider_models(id: String, state: State<'_, AppState>) -> Result<ModelDiscoveryResult, AppError> {
    let provider = state.inner.lock().await.model_providers.iter().find(|provider| provider.id == id).cloned()
        .ok_or_else(|| AppError::Configuration("请先保存服务商。".into()))?;
    discover_models_inner(provider_model(&provider)).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn import_provider_models(id: String, model_ids: Vec<String>, state: State<'_, AppState>) -> Result<Vec<ModelSummary>, AppError> {
    let mut guard = state.inner.lock().await;
    let mut next = guard.clone();
    let provider = next.model_providers.iter().find(|provider| provider.id == id).ok_or_else(|| AppError::Configuration("请先保存服务商。".into()))?;
    let config = provider_model(provider);
    let imported = merge_discovered_models(&mut next, config, model_ids)?;
    persist_runtime_state(&next)?;
    *guard = next;
    Ok(imported)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn provider(name: &str, url: &str, key: &str) -> ModelProvider { ModelProvider { id: String::new(), name: name.into(), base_url: url.into(), provider: ProviderKind::ChatCompletions, api_key: Some(key.into()), enabled: true } }

    #[test]
    fn independent_providers_can_exist_without_models_and_keep_same_named_models_separate() {
        let mut state = RuntimeState { models: vec![], ..RuntimeState::default() };
        let a = upsert(&mut state, provider("服务商 A", "https://a.example/v1", "key-a")).unwrap();
        let b = upsert(&mut state, provider("服务商 B", "https://b.example/v1", "key-b")).unwrap();
        assert!(state.models.is_empty());
        for provider in [&a, &b] { merge_discovered_models(&mut state, provider_model(provider), vec!["same-model".into(), "another-model".into()]).unwrap(); }
        assert_eq!(state.models.len(), 4);
        assert!(state.models.iter().all(|model| model.enabled && model.provider_enabled));
        for provider in [&a, &b] {
            let model = state.models.iter().find(|model| model.provider_id == provider.id).unwrap();
            assert_eq!(model.api_key, provider.api_key);
            assert_eq!(model.base_url, provider.base_url);
        }
        let config = runtime_config_without_secrets(&state);
        assert!(config.model_providers.iter().all(|item| item.api_key.is_none()));
        assert!(!serde_json::to_string(&config).unwrap().contains("key-a"));
        let restored: PersistedRuntimeConfig = serde_json::from_value(serde_json::to_value(config).unwrap()).unwrap();
        assert_eq!(restored.model_providers.len(), 2);
    }

    #[test]
    fn provider_toggle_preserves_model_selection_and_url_change_clears_old_credentials() {
        let mut state = RuntimeState { models: vec![], ..RuntimeState::default() };
        let mut a = upsert(&mut state, provider("A", "https://a.example/v1", "key-a")).unwrap();
        merge_discovered_models(&mut state, provider_model(&a), vec!["one".into(), "two".into()]).unwrap();
        state.models[1].enabled = false;
        a.enabled = false; a.api_key = None;
        a = upsert(&mut state, a).unwrap();
        assert!(state.models.iter().all(|model| !model_summary(model).enabled));
        assert!(state.models[0].enabled && !state.models[1].enabled);
        a.enabled = true; a = upsert(&mut state, a).unwrap();
        assert!(state.models[0].provider_enabled && !state.models[1].enabled);
        assert_eq!(a.api_key.as_deref(), Some("key-a"));
        a.base_url = "https://changed.example/v1".into(); a.api_key = None;
        upsert(&mut state, a).unwrap();
        assert!(state.models.iter().all(|model| model.api_key.is_none() && model.base_url == "https://changed.example/v1"));
    }

    #[test]
    fn legacy_models_migrate_without_changing_profile_ids_or_limits() {
        let mut state = RuntimeState::default();
        state.models[0].api_key = Some("legacy-secret".into());
        sync_active_model(&mut state);
        assert_eq!(state.model_providers.len(), 1);
        assert_eq!(state.models[0].id, "model-default");
        assert_eq!(state.models[0].context_window, DEFAULT_CONTEXT_WINDOW);
        assert_eq!(state.model_providers[0].api_key.as_deref(), Some("legacy-secret"));
        let mut duplicate = state.model_providers[0].clone(); duplicate.id.clear(); duplicate.base_url.push('/');
        assert!(upsert(&mut state, duplicate).is_err());
    }
}
