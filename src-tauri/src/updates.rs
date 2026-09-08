use super::{app_data_root, write_json_atomic, AppState, APP_VERSION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::Cursor, path::{Path, PathBuf}, sync::atomic::{AtomicBool, Ordering}, time::Duration};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

pub static INSTALLING: AtomicBool = AtomicBool::new(false);
const PORTABLE_ENTRIES: [&str; 4] = ["plc-pilot.exe", "pi-agent-host.bundle.mjs", "runtime", "portable.json"];

#[derive(Default)]
pub struct UpdateManager {
    pending: Mutex<Option<PreparedUpdate>>,
}

struct PreparedUpdate {
    update: Update,
    bytes: Option<Vec<u8>>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreferences {
    pub auto_check: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    version: String,
    notes: String,
    size: Option<u64>,
}

fn describe(error: impl std::fmt::Display) -> String { format!("更新未完成：{error}") }

fn executable_directory() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(describe)?;
    dunce::canonicalize(exe.parent().ok_or("无法确定程序目录。")?).map_err(describe)
}

fn portable() -> Result<bool, String> { Ok(executable_directory()?.join("portable.json").is_file()) }

#[tauri::command]
pub fn get_update_preferences() -> Result<Value, String> {
    let path = app_data_root().join("updates/preferences.json");
    let preferences = if path.is_file() {
        serde_json::from_slice::<UpdatePreferences>(&fs::read(path).map_err(describe)?).map_err(describe)?
    } else { UpdatePreferences { auto_check: true } };
    let last_result = fs::read(app_data_root().join("updates/result.json")).ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes)).ok());
    Ok(json!({ "autoCheck": preferences.auto_check, "version": APP_VERSION, "portable": portable()?, "lastResult": last_result }))
}

#[tauri::command]
pub fn save_update_preferences(auto_check: bool) -> Result<(), String> {
    write_json_atomic(&app_data_root().join("updates/preferences.json"), &UpdatePreferences { auto_check }, "更新设置").map_err(describe)
}

fn release_asset(update: &Update) -> Result<&Value, String> {
    let asset = update.raw_json.get("platforms").and_then(Value::as_object)
        .and_then(|platforms| platforms.values().find(|item| item["url"].as_str() == Some(update.download_url.as_str())))
        .ok_or("发布信息中没有对应的安装文件，请稍后重新检查。")?;
    // 固定由本项目 Release 提供程序；散列用于下载完整性，真正的发行身份由官方插件验证签名。
    if update.download_url.scheme() != "https" || update.download_url.host_str() != Some("github.com")
        || !update.download_url.path().starts_with("/1812095643/PLCpilot/releases/download/") {
        return Err("更新地址不属于 PLC Pilot 的正式发布仓库。".into());
    }
    if !asset["sha256"].as_str().is_some_and(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())) {
        return Err("发布文件缺少完整性校验信息，请稍后重新检查。".into());
    }
    Ok(asset)
}

#[tauri::command]
pub async fn check_app_update(app: AppHandle, manager: State<'_, UpdateManager>) -> Result<Option<AvailableUpdate>, String> {
    let mut pending = manager.pending.try_lock().map_err(|_| "正在处理更新，请稍候。")?;
    let mut builder = app.updater_builder().timeout(Duration::from_secs(25));
    if portable()? { builder = builder.target("windows-x86_64-portable"); }
    let mut update = builder.build().map_err(describe)?.check().await.map_err(describe)?;
    let available = if let Some(item) = update.as_mut() {
        // 检查与大文件下载的超时分开：慢网络不能沿用版本检查的短超时。
        item.timeout = Some(Duration::from_secs(600));
        let asset = release_asset(item)?;
        Some(AvailableUpdate { version: item.version.clone(), notes: item.body.clone().unwrap_or_default(), size: asset["size"].as_u64() })
    } else { None };
    *pending = update.map(|update| PreparedUpdate { update, bytes: None });
    Ok(available)
}

fn progress(app: &AppHandle, stage: &str, downloaded: u64, total: Option<u64>) {
    let _ = app.emit("app-update-progress", json!({ "stage": stage, "downloaded": downloaded, "total": total }));
}

fn verify_hash(bytes: &[u8], expected: &str) -> Result<(), String> {
    if !format!("{:x}", Sha256::digest(bytes)).eq_ignore_ascii_case(expected) {
        return Err("下载文件校验未通过，请重新下载；当前程序没有被修改。".into());
    }
    Ok(())
}

struct InstallGuard;
impl Drop for InstallGuard { fn drop(&mut self) { INSTALLING.store(false, Ordering::SeqCst); } }

#[tauri::command]
pub async fn download_app_update(app: AppHandle, version: String, manager: State<'_, UpdateManager>) -> Result<(), String> {
    let mut pending = manager.pending.try_lock().map_err(|_| "更新正在处理中，请稍候。")?;
    let prepared = pending.as_mut().ok_or("请先检查更新。")?;
    if prepared.update.version != version { return Err("可用版本已变化，请重新检查更新。".into()); }
    if prepared.bytes.is_none() {
        progress(&app, "downloading", 0, release_asset(&prepared.update)?["size"].as_u64());
        let mut downloaded = 0u64;
        let mut last_progress = std::time::Instant::now();
        let bytes = prepared.update.download(|length, total| {
            downloaded += length as u64;
            if last_progress.elapsed() >= Duration::from_millis(100) || total == Some(downloaded) {
                progress(&app, "downloading", downloaded, total);
                last_progress = std::time::Instant::now();
            }
        }, || progress(&app, "verifying", 0, None)).await.map_err(describe)?;
        // download 的返回值已经通过 Tauri 官方 minisign 验证，不能把 on_finish 当作验证完成。
        verify_hash(&bytes, release_asset(&prepared.update)?["sha256"].as_str().unwrap_or_default())?;
        prepared.bytes = Some(bytes);
    }
    Ok(())
}

#[tauri::command]
pub async fn install_app_update(app: AppHandle, version: String, manager: State<'_, UpdateManager>, state: State<'_, AppState>) -> Result<(), String> {
    let mut pending = manager.pending.try_lock().map_err(|_| "更新正在处理中，请稍候。")?;
    let prepared = pending.as_mut().ok_or("请先检查更新。")?;
    if prepared.update.version != version || prepared.bytes.is_none() { return Err("请先下载当前可用版本。".into()); }
    let running = state.running.lock().await;
    if !running.is_empty() || state.agent_runs.try_lock().is_err() {
        return Err("更新已下载，请等所有任务结束后再点击安装。".into());
    }
    INSTALLING.store(true, Ordering::SeqCst);
    let _guard = InstallGuard;
    drop(running);
    progress(&app, "installing", 0, None);
    if portable()? {
        let bytes = prepared.bytes.take().ok_or("请重新下载更新。")?;
        let version = prepared.update.version.clone();
        let mut job = tauri::async_runtime::spawn_blocking(move || prepare_portable_update(&bytes, &version)).await.map_err(describe)??;
        // 辅助程序先确认就绪再退出旧进程，脚本启动受限时保留当前可用窗口。
        for _ in 0..100 {
            if job.1.join("ready").exists() { app.exit(0); return Ok(()); }
            if job.0.try_wait().map_err(describe)?.is_some() {
                return Err(format!("更新辅助程序未能启动，请查看 {}。", job.1.join("update.log").display()));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let _ = job.0.kill();
        return Err("更新辅助程序未及时响应，请重试。当前程序保持运行。".into());
    }
    prepared.update.install(prepared.bytes.as_ref().ok_or("请重新下载更新。")?).map_err(describe)
}

/// 只接受便携包内四个程序条目；拒绝路径穿越、链接、重复条目和异常解压体积。
fn extract_portable(bytes: &[u8], stage: &Path) -> Result<PathBuf, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(describe)?;
    let mut seen = std::collections::HashSet::new();
    let mut size = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(describe)?;
        let path = entry.enclosed_name().ok_or("更新包包含越界路径。")?;
        if entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) { return Err("更新包不能包含符号链接。".into()); }
        let parts: Vec<_> = path.components().map(|part| part.as_os_str().to_string_lossy().into_owned()).collect();
        if parts.first().map(String::as_str) != Some("PLC-Pilot-Portable") || parts.iter().any(|part| part == ".." || part == "." || part.contains(':') || part.ends_with('.') || part.ends_with(' ')) {
            return Err("更新包的目录结构不正确。".into());
        }
        if parts.len() > 1 && !PORTABLE_ENTRIES.contains(&parts[1].as_str()) { continue; }
        if !seen.insert(path.to_string_lossy().to_lowercase()) { return Err("更新包包含重复文件。".into()); }
        size = size.checked_add(entry.size()).ok_or("更新包体积超出限制。")?;
        if size > 2 * 1024 * 1024 * 1024 { return Err("更新包解压体积超出限制。".into()); }
        let target = stage.join(&path);
        if entry.is_dir() { fs::create_dir_all(&target).map_err(describe)?; }
        else {
            fs::create_dir_all(target.parent().ok_or("更新文件没有父目录。")?).map_err(describe)?;
            let mut file = fs::File::create(target).map_err(describe)?;
            std::io::copy(&mut entry, &mut file).map_err(describe)?;
        }
    }
    let root = stage.join("PLC-Pilot-Portable");
    for name in ["plc-pilot.exe", "pi-agent-host.bundle.mjs", "portable.json", "runtime/node/node.exe", "runtime/python/python.exe", "runtime/runtime-manifest.json"] {
        if !root.join(name).is_file() { return Err(format!("更新包缺少 {name}，当前程序没有被修改。")); }
    }
    Ok(root)
}

#[cfg(windows)]
fn prepare_portable_update(bytes: &[u8], version: &str) -> Result<(std::process::Child, PathBuf), String> {
    use std::os::windows::process::CommandExt;
    let target = executable_directory()?;
    let staging = tempfile::Builder::new().prefix(".plc-pilot-update-").tempdir_in(target.parent().ok_or("无法确定程序父目录。")?).map_err(|error| format!("程序目录不可写，请把便携版移动到个人目录后重试：{error}"))?;
    let source = extract_portable(bytes, staging.path())?;
    let marker = fs::read(source.join("portable.json")).map_err(describe)?;
    let marker: Value = serde_json::from_slice(marker.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&marker)).map_err(describe)?;
    if marker["product"] != "PLC Pilot" || marker["version"].as_str() != Some(version) {
        return Err("便携包版本与发布信息不一致。".into());
    }
    let result = app_data_root().join("updates/result.json");
    fs::create_dir_all(result.parent().unwrap()).map_err(describe)?;
    let script = staging.path().join("apply-update.ps1");
    // PowerShell 5 按 ANSI 解释无 BOM 文件；显式加 BOM，确保中文路径和提示完整。
    fs::write(&script, format!("\u{feff}{}", include_str!("../../scripts/apply-portable-update.ps1").trim_start_matches('\u{feff}'))).map_err(describe)?;
    let job = staging.path().join("job.json");
    fs::write(&job, serde_json::to_vec(&json!({ "pid": std::process::id(), "target": target, "source": source, "version": version, "result": result })).map_err(describe)?).map_err(describe)?;
    let system_root = std::env::var_os("SystemRoot").ok_or("无法找到 Windows PowerShell。")?;
    let child = std::process::Command::new(PathBuf::from(system_root).join("System32/WindowsPowerShell/v1.0/powershell.exe"))
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]).arg(&script).arg("-JobPath").arg(&job)
        .creation_flags(0x08000000).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
        .spawn().map_err(describe)?;
    Ok((child, staging.keep()))
}

#[cfg(not(windows))]
fn prepare_portable_update(_: &[u8], _: &str) -> Result<(std::process::Child, PathBuf), String> { Err("当前平台不支持 Windows 便携更新。".into()) }

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn archive(names: &[&str]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for name in names { zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap(); zip.write_all(b"contents").unwrap(); }
        zip.finish().unwrap().into_inner()
    }
    #[test]
    fn rejects_corrupt_download() {
        let expected = format!("{:x}", Sha256::digest(b"original"));
        assert!(verify_hash(b"original", &expected).is_ok());
        assert!(verify_hash(b"changed", &expected).is_err());
    }
    #[test]
    fn rejects_unsafe_or_incomplete_archive() {
        let stage = tempfile::tempdir().unwrap();
        for names in [vec!["../escape.txt"], vec!["PLC-Pilot-Portable/plc-pilot.exe"], vec!["PLC-Pilot-Portable/../escape.txt"], vec!["PLC-Pilot-Portable/runtime/a:stream"]] {
            assert!(extract_portable(&archive(&names), stage.path()).is_err());
        }
    }
}
