use super::*;
use tokio::sync::Notify;

#[derive(Clone)]
pub struct RunHandle {
    pub thread_id: String,
    pub session_file: Option<String>,
    pub abort_requested: Arc<AtomicBool>,
    pub abort_notify: Arc<Notify>,
}

/// 固定本轮工程与会话快照；窗口切换仅改变导航，不改变运行中工具的工作目录。
pub async fn isolate_run(root: &AppState, request: &AgentRequest) -> Result<AppState, AppError> {
    let mut runtime = root.inner.lock().await.clone();
    runtime.pending.clear();
    runtime.patches.clear();
    if let Some(path) = request.workspace_path.as_deref() {
        if !runtime.project.path.as_deref().is_some_and(|current| session_paths_equal(current, path)) {
            runtime.project = resolve_project_path(path)?;
        }
    }
    if request.client_thread_id.is_some() {
        runtime.session = if let Some(path) = request.session_file.as_deref() {
            let record = session_record_for_path(path)?;
            if let Some(cwd) = record.cwd.as_deref() {
                if !session_paths_equal(cwd, &agent_cwd(&runtime.project).to_string_lossy()) {
                    return Err(AppError::Project("会话与工作目录不一致，请重新打开该会话。".into()));
                }
            }
            AgentSessionSummary {
                session_id: Some(record.session_id), session_file: Some(record.path),
                name: record.name, message_count: record.message_count,
                ..AgentSessionSummary::default()
            }
        } else { AgentSessionSummary::default() };
    }
    let mut state = AppState::new(runtime);
    state.isolated = true;
    state.running = root.running.clone();
    let request_id = request.request_id.clone().unwrap_or_default();
    let thread_id = request.client_thread_id.clone().unwrap_or_else(|| "desktop-default".into());
    let mut running = root.running.lock().await;
    if running.values().any(|run| run.thread_id == thread_id || request.session_file.as_ref().is_some_and(|path| run.session_file.as_ref().is_some_and(|other| session_paths_equal(path, other)))) {
        return Err(AppError::Configuration("该会话正在运行，请排队发送或先停止当前任务。".into()));
    }
    running.insert(request_id, RunHandle { thread_id, session_file: request.session_file.clone(), abort_requested: state.abort_requested.clone(), abort_notify: state.abort_notify.clone() });
    Ok(state)
}

pub fn session_record_for_path(path: &str) -> Result<SessionRecord, AppError> {
    let resolved = fs::canonicalize(path).map_err(|error| AppError::Configuration(format!("无法读取会话：{error}")))?;
    let root = fs::canonicalize(agent_session_dir()).map_err(|error| AppError::Configuration(format!("会话目录不可读：{error}")))?;
    if !resolved.starts_with(root) || resolved.extension().and_then(|value| value.to_str()) != Some("jsonl") {
        return Err(AppError::Configuration("会话文件不在 PLC Pilot 会话目录中。".into()));
    }
    parse_session_record(&resolved).ok_or_else(|| AppError::Configuration("会话内容无法解析。".into()))
}

pub async fn project_for_cwd(state: &AppState, cwd: &str) -> Result<ProjectContext, AppError> {
    let current = state.inner.lock().await.project.clone();
    if cwd.trim().is_empty() { return Ok(current); }
    let path = if cwd.starts_with("file:") { reqwest::Url::parse(cwd).map_err(|error| AppError::Project(error.to_string()))?.to_file_path().map_err(|_| AppError::Project("文件 URI 不正确。".into()))? } else { PathBuf::from(cwd) };
    if session_paths_equal(&path.to_string_lossy(), &agent_cwd(&current).to_string_lossy()) { return Ok(current); }
    resolve_project_path(&path.to_string_lossy())
}

#[tauri::command]
pub async fn load_workspace_state() -> Result<Option<Value>, AppError> {
    let path = app_data_root().join("workspace-state.json");
    if !path.exists() { return Ok(None); }
    let bytes = fs::read(path).map_err(|error| AppError::Configuration(format!("读取会话界面状态未完成：{error}")))?;
    serde_json::from_slice(&bytes).map(Some).map_err(|error| AppError::Configuration(format!("会话界面状态无法解析：{error}")))
}

#[tauri::command]
pub async fn save_workspace_state(value: Value) -> Result<(), AppError> {
    if !value.get("threads").is_some_and(Value::is_array) {
        return Err(AppError::Configuration("会话界面状态缺少 threads 列表。".into()));
    }
    write_private_json(&app_data_root().join("workspace-state.json"), &value, "会话界面状态")
}

#[tauri::command]
pub async fn start_temporary_workspace(state: State<'_, AppState>) -> Result<ProjectContext, AppError> {
    let stamp = chrono::Local::now();
    let root = dirs::document_dir().unwrap_or_else(app_data_root).join("PLCpilot");
    let path = root.join(stamp.format("%Y-%m-%d").to_string()).join(format!("{}-{}", stamp.format("%H-%M-%S"), &Uuid::new_v4().to_string()[..8]));
    fs::create_dir_all(&path).map_err(|error| AppError::Project(format!("创建临时会话目录未完成：{error}")))?;
    let mut project = resolve_project_path(&path.to_string_lossy())?;
    project.name = Some("临时会话".into());
    let mut guard = state.inner.lock().await;
    guard.project = project.clone();
    guard.session = AgentSessionSummary::default();
    Ok(project)
}

fn draft_path(thread_id: &str) -> Result<PathBuf, AppError> {
    if thread_id.is_empty() || thread_id.len() > 160 || !thread_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte)) {
        return Err(AppError::Configuration("草稿会话标识不正确。".into()));
    }
    Ok(app_data_root().join("drafts").join(format!("{thread_id}.json")))
}

#[tauri::command]
pub async fn load_composer_draft(thread_id: String) -> Result<Option<Value>, AppError> {
    let path = draft_path(&thread_id)?;
    if !path.exists() { return Ok(None); }
    let bytes = fs::read(path).map_err(|error| AppError::Configuration(format!("读取草稿未完成：{error}")))?;
    serde_json::from_slice(&bytes).map(Some).map_err(|error| AppError::Configuration(format!("草稿格式无法解析：{error}")))
}

#[tauri::command]
pub async fn save_composer_draft(thread_id: String, value: Value) -> Result<(), AppError> {
    if !value.is_object() { return Err(AppError::Configuration("草稿内容不是有效对象。".into())); }
    write_private_json(&draft_path(&thread_id)?, &value, "会话草稿")
}

#[tauri::command]
pub async fn launch_codesys(state: State<'_, AppState>) -> Result<Value, AppError> {
    let detected = detect_codesys_installation();
    let path = detected.executable.ok_or_else(|| AppError::Configuration("没有检测到 CODESYS，请安装后重新检查。".into()))?;
    let profile = detected.profile.clone().ok_or_else(|| AppError::Configuration("已找到 CODESYS，但没有找到可用 Profile。请检查安装目录的 Profiles 文件夹。".into()))?;
    if !Path::new(&path).is_file() { return Err(AppError::Configuration("CODESYS 可执行文件不可读，请检查安装路径。".into())); }
    let project_path = state.inner.lock().await.project.path.clone();
    let mut command = Command::new(&path);
    command.arg(format!("--profile={profile}"));
    if let Some(project) = project_path.as_deref().filter(|value| Path::new(value).is_file()) { command.arg(project); }
    #[cfg(windows)] command.creation_flags(CREATE_NO_WINDOW);
    let child = command.spawn().map_err(|error| AppError::Internal(format!("启动 CODESYS 未完成：{error}")))?;
    Ok(json!({ "pid": child.id(), "executable": path, "profile": profile, "project": project_path, "started": true }))
}
