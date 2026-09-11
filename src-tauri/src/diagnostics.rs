use std::{collections::HashSet, path::{Path, PathBuf}, sync::{Mutex, OnceLock}};
use regex::Regex;
use serde_json::{json, Value};
use tracing_appender::rolling::{RollingFileAppender, Rotation};

static LOG_ROOT: OnceLock<PathBuf> = OnceLock::new();
static RUN_ID: OnceLock<String> = OnceLock::new();
static SECRETS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

pub fn run_id() -> &'static str { RUN_ID.get_or_init(|| uuid::Uuid::new_v4().to_string()) }

pub fn root() -> PathBuf {
    LOG_ROOT.get().cloned().unwrap_or_else(|| std::env::var_os("PLC_PILOT_LOG_DIR").map(PathBuf::from).filter(|path| path.is_absolute()).unwrap_or_else(|| super::app_data_root().join("logs")))
}

fn sensitive_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase().replace(['_', '-', ' '], "");
    matches!(normalized.as_str(), "key" | "apikey" | "password" | "passwd" | "secret" | "token" | "accesstoken" | "refreshtoken" | "authorization" | "cookie" | "setcookie" | "serialnumber" | "privatekey" | "clientsecret")
        || ["_api_key", "_password", "_secret", "_token", "_private_key"].iter().any(|suffix| key.to_ascii_lowercase().replace('-', "_").ends_with(suffix))
}

/// 原始凭据只存内存过滤表；不能把模型配置、环境变量或请求头原样写入日志。
pub fn register_secrets(value: &Value) {
    match value {
        Value::Object(fields) => for (key, value) in fields {
            if sensitive_key(key) {
                if let Some(secret) = value.as_str().filter(|value| value.len() >= 4) {
                    if let Ok(mut secrets) = SECRETS.get_or_init(|| Mutex::new(HashSet::new())).lock() { secrets.insert(secret.to_string()); }
                }
            } else { register_secrets(value); }
        },
        Value::Array(values) => for (index, value) in values.iter().enumerate() {
            if index > 0 && values[index - 1].as_str().is_some_and(|key| sensitive_key(key.trim_start_matches('-'))) {
                register_secrets(&json!({"secret": value}));
            } else { register_secrets(value); }
        },
        _ => {},
    }
}

pub fn clip(value: &str, limit: usize) -> String {
    let count = value.chars().count();
    if count <= limit { return value.to_string(); }
    let half = limit / 2;
    format!("{}\n[共 {count} 字符，中间已截断]\n{}", value.chars().take(half).collect::<String>(), value.chars().skip(count - half).collect::<String>())
}

fn sanitize_text(value: &str) -> String {
    let mut text = value.to_string();
    if let Ok(secrets) = SECRETS.get_or_init(|| Mutex::new(HashSet::new())).lock() {
        for secret in secrets.iter() { text = text.replace(secret, "[已隐藏]"); }
    }
    static PATTERNS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    for (pattern, replacement) in PATTERNS.get_or_init(|| vec![
        (Regex::new(r"(?i)(https?://)[^\s/:@]+:[^\s/@]+@").unwrap(), "${1}[已隐藏]@"),
        (Regex::new(r"(?i)((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]+").unwrap(), "${1}[已隐藏]"),
        (Regex::new(r"(?i)([?&](?:api[_-]?key|token|access_token|secret|password)=)[^&#\s]+").unwrap(), "${1}[已隐藏]"),
        (Regex::new(r#"(?i)((?:api[_-]?key|password|passwd|secret|token|authorization|serial[_-]?number)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)"#).unwrap(), "${1}[已隐藏]"),
        (Regex::new(r"data:[^;,\s]+;base64,[A-Za-z0-9+/=\s]+").unwrap(), "[附件数据已隐藏]"),
    ]) { text = pattern.replace_all(&text, *replacement).into_owned(); }
    clip(&text, 16384)
}

pub fn sanitize(value: &Value) -> Value { sanitize_depth(value, 0) }
fn sanitize_depth(value: &Value, depth: usize) -> Value {
    if depth > 10 { return json!("[嵌套层级已截断]"); }
    match value {
        Value::String(value) => json!(sanitize_text(value)),
        Value::Object(fields) => Value::Object(fields.iter().take(100).map(|(key, value)| (key.clone(),
            if key == "data_base64" || key == "blob" || (key == "data" && matches!(fields.get("type").or_else(|| fields.get("kind")).and_then(Value::as_str), Some("image" | "audio"))) { json!("[附件数据已隐藏]") }
            else if sensitive_key(key) { json!("[已隐藏]") } else { sanitize_depth(value, depth + 1) })).collect()),
        Value::Array(values) => Value::Array(values.iter().take(100).enumerate().map(|(index, value)| {
            if index > 0 && values[index - 1].as_str().is_some_and(|key| sensitive_key(key.trim_start_matches('-'))) { json!("[已隐藏]") } else { sanitize_depth(value, depth + 1) }
        }).collect()),
        _ => value.clone(),
    }
}

fn subscriber(directory: &Path) -> Result<impl tracing::Subscriber + Send + Sync, String> {
    // 复用 tracing-appender 的每日轮转，最多保留 14 份桌面日志。
    let writer = RollingFileAppender::builder().rotation(Rotation::DAILY).filename_prefix("desktop").filename_suffix("jsonl").max_log_files(14)
        .build(directory.join("desktop")).map_err(|error| error.to_string())?;
    Ok(tracing_subscriber::fmt().json().with_ansi(false).with_writer(writer)
        .with_env_filter(tracing_subscriber::EnvFilter::new("off,plc_pilot_diagnostics=info")).finish())
}

pub fn init() {
    let preferred = root();
    let (directory, subscriber) = match subscriber(&preferred) {
        Ok(subscriber) => (preferred, subscriber),
        Err(_) => {
            let fallback = std::env::temp_dir().join("PLC Pilot").join("logs");
            match subscriber(&fallback) {
                Ok(subscriber) => (fallback, subscriber),
                Err(error) => { eprintln!("PLC Pilot 日志目录不可写：{error}"); return; }
            }
        }
    };
    let _ = LOG_ROOT.set(directory.clone());
    let _ = tracing::subscriber::set_global_default(subscriber);
    info("app.start", json!({ "executable": std::env::current_exe().ok(), "architecture": std::env::consts::ARCH, "log_directory": directory }));
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic| { error("app.panic", json!({ "panic": panic.to_string() })); previous(panic); }));
}

fn write(level: tracing::Level, event: &str, data: Value) {
    let details = clip(&sanitize(&data).to_string(), 32768);
    let run_id = run_id();
    if level == tracing::Level::ERROR {
        tracing::error!(target: "plc_pilot_diagnostics", event, version = super::APP_VERSION, run_id, pid = std::process::id(), details);
    } else if level == tracing::Level::WARN {
        tracing::warn!(target: "plc_pilot_diagnostics", event, version = super::APP_VERSION, run_id, pid = std::process::id(), details);
    } else {
        tracing::info!(target: "plc_pilot_diagnostics", event, version = super::APP_VERSION, run_id, pid = std::process::id(), details);
    }
}
pub fn info(event: &str, data: Value) { write(tracing::Level::INFO, event, data); }
pub fn warn(event: &str, data: Value) { write(tracing::Level::WARN, event, data); }
pub fn error(event: &str, data: Value) { write(tracing::Level::ERROR, event, data); }

#[tauri::command]
pub fn record_frontend_diagnostic(event: String, details: Value) {
    if event.len() <= 80 && details.to_string().len() <= 65536 {
        warn("frontend.event", json!({ "event": event, "details": details }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logs_redact_secrets_and_preserve_chinese_diagnostics() {
        register_secrets(&json!({"api_key":"secret-test-key-123"}));
        let value = sanitize(&json!({ "api_key": "secret-test-key-123", "error": "中文编译诊断 secret-test-key-123 Authorization: Bearer abcdef", "args": ["--password", "sensitive-value"], "url":"https://user:pass@example.test/api?token=hidden" }));
        let text = value.to_string();
        assert!(!text.contains("secret-test-key-123") && !text.contains("sensitive-value") && !text.contains("abcdef") && !text.contains("user:pass"));
        assert!(text.contains("中文编译诊断"));
        assert!(!sanitize(&json!({"type":"image", "data":"private-image-bytes"})).to_string().contains("private-image-bytes"));
        assert!(clip(&"中文".repeat(10000), 100).contains("截断"));
    }

    #[test]
    fn real_file_logger_writes_error_before_shutdown() {
        let root = tempfile::tempdir().unwrap();
        let subscriber = subscriber(root.path()).unwrap();
        tracing::subscriber::with_default(subscriber, || { error("mcp.test.error", json!({"request_id":"test-request", "message":"未安装 STone"})); });
        let path = std::fs::read_dir(root.path().join("desktop")).unwrap().next().unwrap().unwrap().path();
        let content = std::fs::read_to_string(path).unwrap();
        assert!(content.contains("mcp.test.error") && content.contains("未安装 STone") && content.contains("test-request"));
        serde_json::from_str::<Value>(content.trim()).unwrap();
    }
}
