use super::*;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkbenchMode { #[default] Codesys, Chat, Stone }

pub fn tool_allowed(mode: WorkbenchMode, server: &str, name: &str) -> bool {
    let codesys = server.to_lowercase().contains("codesys") || name.to_lowercase().contains("codesys")
        || (server == BUILTIN_SERVER_ID && matches!(name, "project_snapshot" | "list_pous" | "read_st_source" | "search_project" | "compile_project" | "diagnostics"));
    let stone = server == "plc-pilot-stone" || name.starts_with("stone_");
    match mode { WorkbenchMode::Codesys => !stone, WorkbenchMode::Chat => !codesys && !stone, WorkbenchMode::Stone => !codesys }
}

pub fn skill_allowed(mode: WorkbenchMode, skill: &SkillSummary) -> bool {
    mode == WorkbenchMode::Codesys || builtin_skill_content(&skill.id).is_none()
}

/// 非 CODESYS 模式只扫描用户工作目录，不带入 Bridge 的编辑器、快照和版本信息。
/// Stone 的 .stone/.stprj 和普通文件均保留；文件数量是扫描结果，不等于厂商编译成功。
pub fn project_context(project: &ProjectContext, mode: WorkbenchMode) -> ProjectContext {
    if mode == WorkbenchMode::Codesys { return scan_project_context(project.clone()); }
    let path = project.path.as_deref().map(PathBuf::from);
    let Some(path) = path.filter(|path| path.exists()) else { return ProjectContext::default(); };
    let root = if path.is_dir() { path.clone() } else { path.parent().unwrap_or(&path).to_path_buf() };
    let mut result = ProjectContext { path: Some(path.to_string_lossy().into_owned()), name: project.name.clone(), exists: true,
        project_directory: Some(root.to_string_lossy().into_owned()), working_directory: Some(root.to_string_lossy().into_owned()),
        extension: path.extension().and_then(|value| value.to_str()).map(str::to_string), scan_status: "scanned".into(), ..ProjectContext::default() };
    let extensions = ["stone", "stprj", "stlib", "st", "spark", "json", "xml", "md", "txt", "py", "ts", "js", "rs", "cs", "csv", "xlsx", "docx", "pdf", "html", "css"];
    for entry in WalkDir::new(&root).max_depth(12).follow_links(false).into_iter().filter_entry(|entry| ![".git", "node_modules", "target", "bin", "obj", ".venv"].contains(&entry.file_name().to_string_lossy().as_ref())).flatten() {
        if !entry.file_type().is_file() { continue; }
        result.file_count += 1;
        if result.source_files.len() < 80 && entry.path().extension().and_then(|value| value.to_str()).is_some_and(|extension| extensions.contains(&extension.to_lowercase().as_str())) {
            result.source_files.push(entry.path().strip_prefix(&root).unwrap_or(entry.path()).to_string_lossy().replace('\\', "/"));
        }
        if result.file_count >= 800 { result.scan_status = "warning".into(); break; }
    }
    result.scan_message = Some(if result.file_count >= 800 { "已读取前 800 个文件，可通过文件工具继续查找。" } else { "已读取工作目录文件列表。" }.into());
    result
}

pub fn system_prompt(project: &ProjectContext, mode: WorkbenchMode) -> String {
    if mode == WorkbenchMode::Codesys { return build_system_prompt(project); }
    let introduction = if mode == WorkbenchMode::Chat {
        "你是 PLC Pilot，当前为自由聊天模式。直接帮助用户处理通用问答、编程、文档和文件任务；不要求 PLC 工程或工业软件，不默认执行 PLC 工作流。可使用当前声明的通用工具、MCP、记忆与用户自定义 Skills。"
    } else {
        "你是 PLC Pilot，当前为 CAREL Stone 模式。使用内置 STone MCP 的官方 API 参考与工程自动化工具。先 stone_environment，按需 stone_api_search / stone_api_get。真实工程操作通过 SToneCLI/IronPython；先打开解决方案、读取项目，再修改、保存和编译。必须检查官方 Result.IsSuccessful 或 CLI 退出码。控制器 ST 库参考不是远程接口；未安装 STone 或缺少许可时不得声称已编译。下载、变量写入、重启等操作依照本次用户授权和客户端审批。"
    };
    let custom_skills = discover_skills(project).into_iter().filter(|skill| skill.enabled && skill_allowed(mode, skill))
        .filter_map(|skill| skill.path.and_then(|path| fs::read_to_string(path).ok())).map(|text| truncate(&text, 12000)).collect::<Vec<_>>().join("\n\n");
    format!("{introduction}\n当前工作目录：{}\n扫描到的文件：{}\n先读取再修改，操作结果以真实工具返回为依据。写入与命令遵循客户端批准/拒绝或完全访问模式。\n{custom_skills}",
        project.working_directory.as_deref().or(project.project_directory.as_deref()).unwrap_or("会话工作目录"), project.source_files.join("、"))
}

#[tauri::command]
pub async fn set_workbench_mode(mode: WorkbenchMode, state: State<'_, AppState>) -> Result<ProjectContext, AppError> {
    let mut guard = state.inner.lock().await;
    let mut next = guard.clone();
    next.workbench_mode = mode;
    next.project = project_context(&next.project, mode);
    if mode == WorkbenchMode::Stone && !next.mcp_servers.iter().any(|server| server.id == "plc-pilot-stone") {
        let entry = mcp_catalog_entries().into_iter().find(|entry| entry.id == "plc-pilot-stone").ok_or_else(|| AppError::Mcp("未找到内置 STone MCP 资源。".into()))?;
        next.mcp_servers.push(McpServerConfig { id: entry.id, name: entry.name, command: entry.command, args: entry.args, env: HashMap::new(), enabled: true, transport: entry.transport, url: None, headers: HashMap::new() });
    }
    persist_runtime_state(&next)?;
    let project = next.project.clone();
    *guard = next;
    Ok(project)
}

#[tauri::command]
pub async fn inspect_workbench(path: Option<String>, mode: WorkbenchMode, state: State<'_, AppState>) -> Result<ProjectContext, AppError> {
    let project = match path.filter(|path| !path.trim().is_empty()) { Some(path) => resolve_project_path(&path)?, None => state.inner.lock().await.project.clone() };
    Ok(project_context(&project, mode))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn modes_select_actual_tool_and_prompt_scope() {
        assert!(!tool_allowed(WorkbenchMode::Chat, "codesys-server", "build"));
        assert!(!tool_allowed(WorkbenchMode::Chat, "plc-pilot-stone", "stone_solution_build"));
        assert!(tool_allowed(WorkbenchMode::Stone, "plc-pilot-stone", "stone_solution_build"));
        assert!(!tool_allowed(WorkbenchMode::Stone, BUILTIN_SERVER_ID, "compile_project"));
        for mode in [WorkbenchMode::Codesys, WorkbenchMode::Chat, WorkbenchMode::Stone] { assert!(tool_allowed(mode, BUILTIN_SERVER_ID, "exec_command")); }
        let prompt = system_prompt(&ProjectContext::default(), WorkbenchMode::Chat);
        assert!(!prompt.contains("CODESYS"));
        assert!(system_prompt(&ProjectContext::default(), WorkbenchMode::Stone).contains("SToneCLI"));
    }
    #[test]
    fn stone_and_chat_scan_without_codesys_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("example.stone"), "").unwrap(); fs::write(directory.path().join("notes.md"), "记录").unwrap();
        let project = ProjectContext { path: Some(directory.path().to_string_lossy().into()), snapshot_id: Some("codesys-snapshot".into()), version: Some("SP22".into()), ..ProjectContext::default() };
        let result = project_context(&project, WorkbenchMode::Stone);
        assert_eq!(result.source_files.len(), 2); assert!(result.snapshot_id.is_none() && result.version.is_none());
    }
}
