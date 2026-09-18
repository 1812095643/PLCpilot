use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

// 安装器与官方插件共用 HKCU Run 中的「PLC Pilot」项；不另存一份可能失真的配置。
#[tauri::command]
pub fn get_startup_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|error| format!("无法读取开机自启状态：{error}"))
}

#[tauri::command]
pub fn set_startup_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    if enabled { manager.enable() } else { manager.disable() }
        .map_err(|error| format!("无法保存开机自启设置：{error}"))?;
    #[cfg(windows)]
    if enabled {
        // 安装路径可能含空格；为插件写入的可执行文件路径补上引号，确保登录时正确启动。
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
            .open_subkey_with_flags("Software\\Microsoft\\Windows\\CurrentVersion\\Run", winreg::enums::KEY_SET_VALUE)
            .and_then(|key| key.set_value("PLC Pilot", &format!("\"{}\"", executable.display())))
            .map_err(|error| format!("无法保存启动路径：{error}"))?;
    }
    manager.is_enabled().map_err(|error| format!("无法确认开机自启状态：{error}"))
}
