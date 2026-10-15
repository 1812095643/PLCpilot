//! 生图工作台只编排现有生图后端；任务与聊天隔离，历史保存引用和缩略图。
use super::*;
use crate::image_generation::ImageProgress;

fn history_directory() -> PathBuf { app_data_root().join("image-studio").join("history") }

fn history_path(id: &str) -> Result<PathBuf, AppError> {
    Uuid::parse_str(id).map_err(|_| AppError::Configuration("图片任务编号不可用。".into()))?;
    Ok(history_directory().join(format!("{id}.json")))
}

pub(crate) fn persist(progress: &ImageProgress) -> Result<(), AppError> {
    let mut entry = progress.clone();
    // 大图保存在实际输出文件，避免历史列表反复加载整张图片的 base64。
    entry.image_url = None;
    write_json_atomic(&history_path(&entry.id)?, &entry, "生图历史")
}

#[tauri::command]
pub async fn get_image_studio_history(state: State<'_, AppState>) -> Result<Vec<ImageProgress>, AppError> {
    if !history_directory().is_dir() { return Ok(Vec::new()); }
    let registry = state.running.lock().await;
    let running = registry.keys().cloned().collect::<HashSet<_>>();
    let scopes = registry.values().map(|run| run.thread_id.clone()).collect::<HashSet<_>>();
    drop(registry);
    let files = fs::read_dir(history_directory()).map_err(|e| AppError::Configuration(e.to_string()))?;
    let mut records = Vec::new();
    for file in files.flatten().filter(|entry| entry.path().extension().is_some_and(|value| value == "json")) {
        let Ok(bytes) = fs::read(file.path()) else { continue; };
        let Ok(mut record) = serde_json::from_slice::<ImageProgress>(&bytes) else { continue; };
        if matches!(record.status.as_str(), "generating" | "partial") && !running.contains(&record.id) && !scopes.contains(&record.scope) {
            record.status = "cancelled".into();
            record.error = Some("上次生成随程序退出而停止，可重新使用这份提示词。".into());
            record.finished_at = Some(now_iso());
            persist(&record)?;
        }
        records.push(record);
    }
    records.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    records.truncate(120);
    Ok(records)
}

#[tauri::command]
pub async fn start_image_studio_generation(app: AppHandle, state: State<'_, AppState>, request: Value) -> Result<ImageProgress, AppError> {
    let id = Uuid::new_v4().to_string();
    let (model, progress) = image_generation::prepare(&request, "image-studio", id.clone())?;
    let mut runtime = state.inner.lock().await.clone();
    let provider = runtime.model_providers.iter().find(|provider| provider.id == model.provider_id && provider.enabled)
        .ok_or_else(|| AppError::Configuration("所选生图服务商未启用，请在设置中启用。".into()))?;
    if provider.api_key.as_deref().is_none_or(|value| value.trim().is_empty()) {
        return Err(AppError::Configuration("请先在设置中保存此服务商的 API Key。".into()));
    }
    let directory = dirs::document_dir().unwrap_or_else(app_data_root).join("PLCpilot").join("Images").join(Utc::now().format("%Y-%m-%d").to_string());
    fs::create_dir_all(&directory).map_err(|e| AppError::Project(format!("无法创建生图输出目录：{e}")))?;
    // 工作台使用独立工作目录，打开生图页不改变任何正在运行的聊天/PLC 工程。
    runtime.project = ProjectContext {
        path: Some(directory.to_string_lossy().into_owned()),
        working_directory: Some(directory.to_string_lossy().into_owned()),
        project_directory: Some(directory.to_string_lossy().into_owned()),
        name: Some("生图工作台".into()), exists: true, ..ProjectContext::default()
    };
    let mut job = AppState::new(runtime);
    job.isolated = true;
    job.document_scope = "image-studio".into();
    let registry = state.running.clone();
    let mut running = registry.lock().await;
    if updates::INSTALLING.load(Ordering::SeqCst) { return Err(AppError::Configuration("软件正在安装更新，重启后即可生成。".into())); }
    if running.values().any(|run| run.thread_id == "image-studio") { return Err(AppError::Configuration("当前图片仍在生成，请等待或先停止。".into())); }
    persist(&progress)?;
    running.insert(id.clone(), agent_runtime::RunHandle { thread_id: "image-studio".into(), session_file: None,
        abort_requested: job.abort_requested.clone(), abort_notify: job.abort_notify.clone() });
    drop(running);
    let initial = progress.clone();
    tauri::async_runtime::spawn(async move {
        let result = image_generation::execute(&app, &job, model, progress).await;
        if let Err(error) = result { diagnostics::warn("image.studio", json!({"id":id,"error":error.to_string()})); }
        registry.lock().await.remove(&id);
    });
    Ok(initial)
}

#[tauri::command]
pub async fn cancel_image_studio_generation(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let running = state.running.lock().await;
    if let Some(job) = running.get(&id).filter(|job| job.thread_id == "image-studio") {
        job.abort_requested.store(true, Ordering::SeqCst);
        job.abort_notify.notify_one();
    }
    Ok(())
}

#[tauri::command]
pub async fn save_image_studio_result(id: String) -> Result<Option<String>, AppError> {
    let record: ImageProgress = serde_json::from_slice(&fs::read(history_path(&id)?).map_err(|e| AppError::Project(e.to_string()))?)
        .map_err(|e| AppError::Project(e.to_string()))?;
    let source = record.path.ok_or_else(|| AppError::Project("图片尚未生成完成。".into()))?;
    let filename = Path::new(&source).file_name().unwrap_or_default().to_string_lossy().into_owned();
    let destination = rfd::AsyncFileDialog::new().set_file_name(filename).save_file().await;
    let Some(destination) = destination else { return Ok(None); };
    if dunce::canonicalize(&source).ok() != dunce::canonicalize(destination.path()).ok() {
        fs::copy(&source, destination.path()).map_err(|e| AppError::Project(format!("图片另存未完成：{e}")))?;
    }
    Ok(Some(destination.path().to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_identifiers_cannot_escape_the_history_directory() {
        assert!(history_path("../config").is_err());
        assert!(history_path("C:/example").is_err());
        assert_eq!(history_path(&Uuid::nil().to_string()).unwrap().parent(), Some(history_directory().as_path()));
    }
}
