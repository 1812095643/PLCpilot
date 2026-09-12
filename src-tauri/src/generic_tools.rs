use super::*;
use codex_apply_patch::{ApplyPatchFileChange, Hunk, MaybeApplyPatchVerified};

static PATCH_WRITES: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn tools() -> Vec<McpTool> {
    vec![
        McpTool { server_id: BUILTIN_SERVER_ID.into(), name: "read_document".into(), description: Some("读取工作目录中的 Excel、PDF、Word 或文本文件，返回提取的实际正文。二进制文档应使用此工具。".into()), input_schema: json!({"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}) },
        McpTool { server_id: BUILTIN_SERVER_ID.into(), name: "apply_patch".into(), description: Some(format!("提交 Codex 格式的多文件补丁，先生成 Diff，用户审批后才写入。{}", codex_apply_patch::APPLY_PATCH_TOOL_INSTRUCTIONS)), input_schema: json!({"type":"object","properties":{"patch":{"type":"string"}},"required":["patch"],"additionalProperties":false}) },
        McpTool { server_id: BUILTIN_SERVER_ID.into(), name: "propose_write".into(), description: Some("提交完整文件正文，支持新建文件；用户审批后才写入。".into()), input_schema: json!({"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"},"expected":{"type":"string"}},"required":["path","content"],"additionalProperties":false}) },
        McpTool { server_id: BUILTIN_SERVER_ID.into(), name: "exec_command".into(), description: Some("提交 PowerShell 命令，固定在当前工作目录执行。命令必须由用户审批；输出嵌入工具详情，不打开终端窗口。".into()), input_schema: json!({"type":"object","properties":{"command":{"type":"string"},"timeout":{"type":"number","minimum":1,"maximum":120}},"required":["command"],"additionalProperties":false}) },
    ]
}

fn checked_path(cwd: &Path, requested: &Path) -> Result<PathBuf, AppError> {
    let root = dunce::canonicalize(cwd).map_err(|error| AppError::Project(error.to_string()))?;
    let candidate = if requested.is_absolute() { requested.to_path_buf() } else { root.join(requested) };
    if candidate.components().any(|part| matches!(part, std::path::Component::ParentDir)) { return Err(AppError::Project("补丁路径不能包含上级目录。".into())); }
    let existing = candidate.ancestors().find(|path| path.exists()).ok_or_else(|| AppError::Project("路径没有可读取的父目录。".into()))?;
    let resolved = dunce::canonicalize(existing).map_err(|error| AppError::Project(error.to_string()))?;
    if !resolved.starts_with(&root) { return Err(AppError::Project("文件操作必须位于本轮工作目录内。".into())); }
    Ok(resolved.join(candidate.strip_prefix(existing).map_err(|error| AppError::Project(error.to_string()))?))
}

fn absolute_hunks(patch: &str, cwd: &Path) -> Result<Vec<Hunk>, AppError> {
    let mut parsed = codex_apply_patch::parse_patch(patch).map_err(|error| AppError::Project(format!("Codex 补丁格式不正确：{error}")))?;
    for hunk in &mut parsed.hunks {
        match hunk {
            Hunk::AddFile { path, .. } | Hunk::DeleteFile { path } => { *path = checked_path(cwd, path)?; }
            Hunk::UpdateFile { path, move_path, .. } => {
                *path = checked_path(cwd, path)?;
                if let Some(destination) = move_path { *destination = checked_path(cwd, destination)?; }
            }
        }
    }
    Ok(parsed.hunks)
}

pub async fn propose(state: &AppState, tool: &str, mut arguments: Value) -> Result<PendingChangeSummary, AppError> {
    let runtime = state.inner.lock().await;
    let cwd = dunce::canonicalize(agent_cwd(&runtime.project)).map_err(|error| AppError::Project(error.to_string()))?;
    let session_file = runtime.session.session_file.clone();
    drop(runtime);
    let mut expected = HashMap::<String, Option<String>>::new();
    let preview = match tool {
        "apply_patch" => {
            let patch = arguments.get("patch").and_then(Value::as_str).ok_or_else(|| AppError::Project("apply_patch 需要 patch 正文。".into()))?;
            let hunks = absolute_hunks(patch, &cwd)?;
            for hunk in &hunks {
                let mut paths = vec![hunk.resolve_path(&cwd)];
                if let Hunk::UpdateFile { move_path: Some(path), .. } = hunk { paths.push(path.clone()); }
                for path in paths {
                    let before = if path.exists() { Some(fs::read_to_string(&path).map_err(|error| AppError::Project(format!("读取补丁原文未完成：{error}")))?) } else { None };
                    expected.insert(path.to_string_lossy().into_owned(), before);
                }
            }
            let action = match codex_apply_patch::maybe_parse_apply_patch_verified(&["apply_patch".into(), patch.into()], &cwd) {
                MaybeApplyPatchVerified::Body(action) => action,
                other => return Err(AppError::Project(format!("Codex 补丁校验未通过：{other:?}"))),
            };
            action.changes().iter().map(|(path, change)| match change {
                ApplyPatchFileChange::Update { unified_diff, .. } => unified_diff.clone(),
                ApplyPatchFileChange::Add { content } => TextDiff::from_lines(expected.get(&path.to_string_lossy().into_owned()).and_then(Option::as_deref).unwrap_or(""), content).unified_diff().header("原文件", &path.to_string_lossy()).to_string(),
                ApplyPatchFileChange::Delete { content } => TextDiff::from_lines(content.as_str(), "").unified_diff().header(&path.to_string_lossy(), "/dev/null").to_string(),
            }).collect::<Vec<_>>().join("\n")
        }
        "propose_write" => {
            let requested = arguments.get("path").and_then(Value::as_str).ok_or_else(|| AppError::Project("写入文件需要 path。".into()))?;
            let path = checked_path(&cwd, Path::new(requested))?;
            let before = if path.exists() { Some(fs::read_to_string(&path).map_err(|error| AppError::Project(error.to_string()))?) } else { None };
            if arguments.get("expected").and_then(Value::as_str).is_some_and(|value| Some(value) != before.as_deref()) { return Err(AppError::Project("文件已变化，请重新读取后生成修改。".into())); }
            let after = arguments.get("content").and_then(Value::as_str).ok_or_else(|| AppError::Project("写入文件需要 content。".into()))?;
            let diff = TextDiff::from_lines(before.as_deref().unwrap_or(""), after).unified_diff().header("原文件", &path.to_string_lossy()).to_string();
            expected.insert(path.to_string_lossy().into_owned(), before);
            arguments["path"] = json!(path);
            diff
        }
        "exec_command" => {
            let command = arguments.get("command").and_then(Value::as_str).filter(|value| !value.trim().is_empty()).ok_or_else(|| AppError::Configuration("命令内容不能为空。".into()))?;
            format!("工作目录：{}\n\n{command}", cwd.display())
        }
        _ => return Err(AppError::Configuration("未注册的通用工具。".into())),
    };
    arguments["cwd"] = json!(cwd);
    arguments["session_file"] = json!(session_file);
    arguments["expected_files"] = json!(expected);
    let id = Uuid::new_v4().to_string();
    let summary = PendingChangeSummary { id: id.clone(), title: if tool == "exec_command" { "审批后运行 PowerShell 命令".into() } else { format!("审批后应用文件修改（{} 个文件）", expected.len()) }, description: cwd.to_string_lossy().into_owned(), diff: preview, server_id: BUILTIN_SERVER_ID.into(), tool_name: tool.into(), risk: "需要人工审批".into(), status: "pending".into() };
    let pending = PendingChange { summary: summary.clone(), arguments };
    state.inner.lock().await.pending.insert(id.clone(), pending.clone());
    // Agent 使用隔离状态运行，但审批按钮属于桌面控制面；同时登记共享注册表，
    // 让用户在模型轮次仍处于 busy 时就能操作这条动作。
    state.approvals.lock().await.insert(id, pending);
    Ok(summary)
}

pub fn apply_patch(pending: &PendingChange) -> Result<ToolCallResult, AppError> {
    let _guard = PATCH_WRITES.lock().map_err(|_| AppError::Internal("文件写入锁不可用。".into()))?;
    let cwd = Path::new(pending.arguments.get("cwd").and_then(Value::as_str).ok_or_else(|| AppError::Project("审批动作缺少工作目录。".into()))?);
    let expected: HashMap<String, Option<String>> = serde_json::from_value(pending.arguments["expected_files"].clone()).map_err(|error| AppError::Project(error.to_string()))?;
    for (path, before) in &expected {
        let path = checked_path(cwd, Path::new(path))?;
        let actual = if path.exists() { Some(fs::read_to_string(path).map_err(|error| AppError::Project(error.to_string()))?) } else { None };
        if &actual != before { return Err(AppError::Project("审批期间文件已被修改，请重新生成 Diff，避免覆盖新内容。".into())); }
    }
    let hunks = if pending.summary.tool_name == "propose_write" {
        vec![Hunk::AddFile { path: checked_path(cwd, Path::new(pending.arguments["path"].as_str().unwrap_or_default()))?, contents: pending.arguments["content"].as_str().unwrap_or_default().to_string() }]
    } else { absolute_hunks(pending.arguments["patch"].as_str().unwrap_or_default(), cwd)? };
    let mut output = Vec::new(); let mut error = Vec::new();
    codex_apply_patch::apply_hunks(&hunks, &mut output, &mut error).map_err(|error| AppError::Project(format!("应用 Codex 补丁未完成：{error}")))?;
    Ok(json_content(&json!({ "message": String::from_utf8_lossy(&output), "files": expected.keys().collect::<Vec<_>>() }), false))
}

/// 无模型的 Pi 工具宿主，用于审批后的真实 PowerShell 执行及会话上下文记录。
pub async fn host_action(app: &AppHandle, state: &AppState, pending: &PendingChange, action: &str, stream: Option<&AgentStreamSender>, context: Option<&Vec<Value>>) -> Result<ToolCallResult, AppError> {
    let host_path = agent_host_path(app);
    let mut command = Command::new(agent_node_command(app));
    // 审批后使用独立宿主；必须和主 Agent 一起继承内置运行时，否则批准后
    // 的 python/npm 命令仍会依赖开发机 PATH，在空电脑上出现“找不到命令”。
    configure_bundled_runtime(&mut command, None);
    command.arg(dunce::simplified(&host_path)).current_dir(pending.arguments["cwd"].as_str().unwrap_or(".")).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)] command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command.spawn().map_err(|error| AppError::Internal(format!("启动 Pi 工具宿主未完成：{error}")))?;
    let helper = AppState::new(RuntimeState::default());
    let key = format!("approval-{}", pending.summary.id);
    if action == "execute_approved" {
        state.running.lock().await.insert(key.clone(), agent_runtime::RunHandle {
            thread_id: key.clone(), session_file: pending.arguments["session_file"].as_str().map(str::to_string),
            abort_requested: helper.abort_requested.clone(), abort_notify: helper.abort_notify.clone(),
        });
    }
    let mut stdin = child.stdin.take().ok_or_else(|| AppError::Internal("工具 stdin 不可用。".into()))?;
    let mut stdout = BufReader::new(child.stdout.take().ok_or_else(|| AppError::Internal("工具 stdout 不可用。".into()))?);
    let result = async {
        read_host_json_or_abort(&mut stdout, &helper).await?;
        write_host_json(&mut stdin, json!({"type":action,"arguments":pending.arguments,"context":context})).await?;
        loop {
            let value = read_host_json_or_abort(&mut stdout, &helper).await?;
            match value["type"].as_str() {
                Some("tool_progress") => if let Some(stream) = stream { stream.send_event(AgentEvent::new(&pending.summary.id, "command", &format!("正在运行命令 {}", pending.arguments["command"].as_str().unwrap_or_default()), Some(value["text"].as_str().unwrap_or_default().into()), "running", Some("powershell".into()))); },
                Some("result") => return Ok(ToolCallResult { content: value["content"].as_array().cloned().unwrap_or_default(), is_error: value["is_error"].as_bool().unwrap_or(false) }),
                Some("error") => return Err(AppError::Internal(value["message"].as_str().unwrap_or("Pi 工具未完成。").into())),
                _ => {}
            }
        }
    }.await;
    if helper.abort_requested.load(Ordering::SeqCst) {
        let _ = write_host_json(&mut stdin, json!({"type":"abort"})).await;
        let _ = timeout(Duration::from_secs(3), async { loop { let value = read_host_json(&mut stdout).await?; if matches!(value["type"].as_str(), Some("error" | "result")) { return Ok::<(), AppError>(()); } } }).await;
    }
    if action == "execute_approved" { state.running.lock().await.remove(&key); }
    let _ = child.kill().await;
    result
}
