use super::*;

#[derive(Clone, Serialize, Deserialize)]
pub struct CustomSkill { pub id: String, pub path: String }

#[derive(Clone, Serialize, Deserialize)]
pub struct RetryPreferences { pub max_retries: u32, pub base_delay_ms: u64, pub max_delay_ms: u64 }
impl Default for RetryPreferences {
    fn default() -> Self { Self { max_retries: 5, base_delay_ms: 1000, max_delay_ms: 60000 } }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Preferences {
    #[serde(default)] pub custom_skills: Vec<CustomSkill>,
    #[serde(default)] pub disabled_skills: HashSet<String>,
    #[serde(default)] pub retry: RetryPreferences,
    #[serde(default)] pub theme: Option<String>,
    #[serde(default = "default_access_mode")] pub access_mode: String,
}

fn default_access_mode() -> String { "approval".into() }

impl Default for Preferences {
    fn default() -> Self {
        Self { custom_skills: Vec::new(), disabled_skills: HashSet::new(), retry: RetryPreferences::default(), theme: None, access_mode: default_access_mode() }
    }
}

pub fn read_preferences() -> Result<Preferences, AppError> {
    let path = app_data_root().join("preferences.json");
    if !path.exists() { return Ok(Preferences::default()); }
    let bytes = fs::read(path).map_err(|error| AppError::Configuration(format!("读取偏好设置未完成：{error}")))?;
    serde_json::from_slice(&bytes).map_err(|error| AppError::Configuration(format!("偏好设置无法解析：{error}")))
}

fn persist(preferences: &Preferences) -> Result<(), AppError> {
    write_json_atomic(&app_data_root().join("preferences.json"), preferences, "偏好设置")
}

pub fn apply_skill_preferences(skills: &mut Vec<SkillSummary>) {
    let preferences = read_preferences().unwrap_or_default();
    for custom in preferences.custom_skills {
        let content = fs::read_to_string(&custom.path);
        let (name, description) = content.as_ref().map(|text| parse_skill_frontmatter(text, &custom.id)).unwrap_or_else(|error| (Path::new(&custom.path).parent().and_then(Path::file_name).map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| custom.id.clone()), format!("无法读取 Skill：{error}")));
        skills.retain(|skill| !skill.path.as_deref().is_some_and(|path| session_paths_equal(path, &custom.path)));
        skills.push(SkillSummary { id: custom.id, name, description, enabled: true, scope: "custom".into(), path: Some(custom.path), content_available: content.is_ok_and(|text| !text.trim().is_empty()) });
    }
    for skill in skills { skill.enabled = !preferences.disabled_skills.contains(&skill.id); }
}

#[tauri::command]
pub async fn get_preferences() -> Result<Preferences, AppError> { read_preferences() }

#[tauri::command]
pub async fn save_theme_preference(theme: String) -> Result<(), AppError> {
    if !matches!(theme.as_str(), "light" | "dark" | "system") { return Err(AppError::Configuration("请选择明亮、暗黑或跟随系统。".into())); }
    let mut preferences = read_preferences()?;
    preferences.theme = Some(theme);
    persist(&preferences)
}

#[tauri::command]
pub async fn save_retry_settings(retry: RetryPreferences) -> Result<(), AppError> {
    if retry.max_retries > 20 || retry.base_delay_ms < 100 || retry.max_delay_ms < retry.base_delay_ms || retry.max_delay_ms > 300000 {
        return Err(AppError::Configuration("重试次数应为 0 至 20，等待时间应为 100 至 300000 毫秒，最大等待不得小于初始等待。".into()));
    }
    let mut preferences = read_preferences()?;
    preferences.retry = retry;
    persist(&preferences)
}

#[tauri::command]
pub async fn save_access_mode(access_mode: String) -> Result<(), AppError> {
    if !matches!(access_mode.trim(), "approval" | "full") {
        return Err(AppError::Configuration("访问模式只能是审批模式或完全访问模式。".into()));
    }
    let mut preferences = read_preferences()?;
    preferences.access_mode = access_mode.trim().to_string();
    persist(&preferences)
}

#[tauri::command]
pub async fn save_skill(id: Option<String>, path: String) -> Result<(), AppError> {
    let mut path = PathBuf::from(path.trim().trim_matches('"'));
    if path.is_dir() { path = path.join("SKILL.md"); }
    if path.file_name().and_then(|name| name.to_str()) != Some("SKILL.md") {
        return Err(AppError::Configuration("请选择 Skill 目录或其中的 SKILL.md 文件。".into()));
    }
    let path = dunce::canonicalize(path).map_err(|error| AppError::Configuration(format!("无法打开 Skill：{error}")))?;
    let content = fs::read_to_string(&path).map_err(|error| AppError::Configuration(format!("读取 Skill 未完成：{error}")))?;
    if content.trim().is_empty() || content.len() > 512 * 1024 { return Err(AppError::Configuration("Skill 内容不能为空且不得超过 512 KB。".into())); }
    let mut preferences = read_preferences()?;
    let path = path.to_string_lossy().into_owned();
    let id = id.filter(|id| !id.is_empty()).or_else(|| preferences.custom_skills.iter().find(|skill| session_paths_equal(&skill.path, &path)).map(|skill| skill.id.clone())).unwrap_or_else(|| format!("custom-{}", Uuid::new_v4()));
    preferences.custom_skills.retain(|skill| skill.id != id);
    preferences.custom_skills.push(CustomSkill { id, path });
    persist(&preferences)
}

#[tauri::command]
pub async fn toggle_skill(id: String, enabled: bool) -> Result<(), AppError> {
    let mut preferences = read_preferences()?;
    if enabled { preferences.disabled_skills.remove(&id); } else { preferences.disabled_skills.insert(id); }
    persist(&preferences)
}

#[tauri::command]
pub async fn delete_skill(id: String) -> Result<(), AppError> {
    let mut preferences = read_preferences()?;
    preferences.custom_skills.retain(|skill| skill.id != id);
    preferences.disabled_skills.remove(&id);
    persist(&preferences)
}

#[tauri::command]
pub async fn pick_skill_path() -> Result<Option<String>, AppError> {
    Ok(rfd::AsyncFileDialog::new().set_title("选择 SKILL.md").add_filter("Skill", &["md"]).pick_file().await.map(|file| file.path().to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn list_mcp_catalog() -> Result<Vec<McpCatalogEntry>, AppError> { Ok(mcp_catalog_entries()) }

#[tauri::command]
pub async fn install_mcp_catalog(id: String, state: State<'_, AppState>) -> Result<Vec<McpSummary>, AppError> {
    let entry = mcp_catalog_entries().into_iter().find(|item| item.id == id).ok_or_else(|| AppError::Configuration("没有找到这个 MCP 商店条目。".into()))?;
    let workspace = {
        let guard = state.inner.lock().await;
        agent_cwd(&guard.project).to_string_lossy().into_owned()
    };
    let args = entry.args.into_iter().map(|arg| if arg == "." { workspace.clone() } else { arg }).collect();
    let mut env = HashMap::new();
    if entry.requires_codesys {
        let codesys = detect_codesys_installation();
        if let Some(path) = codesys.executable {
            env.insert("CODESYS_PATH".into(), path.clone());
            env.insert("CODESYS_EXE".into(), path.clone());
            env.insert("FESTO_MCP_CODESYS_PATH".into(), path);
        }
        if let Some(profile) = codesys.profile {
            env.insert("CODESYS_PROFILE".into(), profile.clone());
            env.insert("FESTO_MCP_CODESYS_PROFILE".into(), profile);
        }
    }
    let server = McpServerConfig { id: entry.id, name: entry.name, command: entry.command, args, env, enabled: true, transport: entry.transport, url: None, headers: HashMap::new() };
    let result = save_mcp_server(server, state).await?;
    Ok(result)
}

#[tauri::command]
pub async fn list_skill_catalog(state: State<'_, AppState>) -> Result<Vec<SkillCatalogEntry>, AppError> {
    let project = state.inner.lock().await.project.clone();
    Ok(skill_catalog_entries(&project))
}

#[tauri::command]
pub async fn install_skill_catalog(id: String) -> Result<(), AppError> {
    let content = builtin_skill_content(&id).ok_or_else(|| AppError::Configuration("这个 Skill 没有可安装的已核验内容。".into()))?;
    if id.is_empty() || id.chars().any(|value| !(value.is_ascii_alphanumeric() || value == '-' || value == '_')) { return Err(AppError::Configuration("Skill 标识不符合目录命名规则。".into())); }
    let directory = app_data_root().join("skills").join(&id);
    fs::create_dir_all(&directory).map_err(|error| AppError::Configuration(format!("创建 Skill 目录未完成：{error}")))?;
    fs::write(directory.join("SKILL.md"), content).map_err(|error| AppError::Configuration(format!("安装 Skill 未完成：{error}")))?;
    Ok(())
}

#[tauri::command]
pub async fn get_mcp_configs(state: State<'_, AppState>) -> Result<Vec<McpServerConfig>, AppError> {
    let mut servers = state.inner.lock().await.mcp_servers.clone();
    for server in &mut servers {
        for (key, value) in &mut server.env { if is_secret_env_key(key) { value.clear(); } }
        for (key, value) in &mut server.headers { if is_secret_header_key(key) { value.clear(); } }
    }
    Ok(servers)
}

#[tauri::command]
pub async fn save_mcp_server(mut server: McpServerConfig, state: State<'_, AppState>) -> Result<Vec<McpSummary>, AppError> {
    let mut servers = state.inner.lock().await.mcp_servers.clone();
    if server.id.trim().is_empty() { server.id = format!("mcp-{}", Uuid::new_v4()); }
    if let Some(existing) = servers.iter().find(|entry| entry.id == server.id) {
        for (key, value) in &existing.env {
            if is_secret_env_key(key) && server.env.get(key).is_some_and(|value| value.is_empty()) { server.env.insert(key.clone(), value.clone()); }
        }
    }
    if let Some(existing) = servers.iter_mut().find(|entry| entry.id == server.id) { *existing = server; } else { servers.push(server); }
    configure_mcp_inner(ConfigureMcpRequest { servers }, &state).await
}

#[tauri::command]
pub async fn delete_mcp_server(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let mut guard = state.inner.lock().await;
    guard.mcp_servers.retain(|server| server.id != id);
    persist_runtime_state(&guard)
}

#[tauri::command]
pub async fn duplicate_mcp_server(id: String, state: State<'_, AppState>) -> Result<Vec<McpSummary>, AppError> {
    let mut servers = state.inner.lock().await.mcp_servers.clone();
    let mut server = servers.iter().find(|server| server.id == id).cloned().ok_or_else(|| AppError::Configuration("MCP 服务不存在。".into()))?;
    server.id = format!("mcp-{}", Uuid::new_v4());
    server.name = format!("{} 副本", server.name);
    servers.push(server);
    configure_mcp_inner(ConfigureMcpRequest { servers }, &state).await
}

#[tauri::command]
pub async fn probe_mcp_server(id: String, state: State<'_, AppState>) -> Result<Vec<ToolSummary>, AppError> {
    let server = state.inner.lock().await.mcp_servers.iter().find(|server| server.id == id).cloned().ok_or_else(|| AppError::Configuration("MCP 服务不存在。".into()))?;
    if !server.enabled { return Err(AppError::Configuration("该 MCP 已关闭，请启用后再连接。".into())); }
    let tools = McpClient::new(server).list_tools().await?.into_iter().map(tool_summary_from_mcp).collect::<Vec<_>>();
    if tools.is_empty() { return Err(AppError::Mcp("没有发现可用工具，请检查命令、参数、URL 和认证信息。".into())); }
    Ok(tools)
}
