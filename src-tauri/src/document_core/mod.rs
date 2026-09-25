//! 文档工作区的统一入口。原文件、对象定位和版本由后端持有，避免预览与写入分叉。
use std::{collections::HashMap, fs, path::{Path, PathBuf}, sync::{Mutex, OnceLock}};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use super::{app_data_root, AppError};
use tauri::Emitter;
mod ooxml;
mod docx;
mod xlsx;
mod pptx;
pub(crate) mod patch;
mod pdf;
pub mod agent;
pub use patch::DocumentOperation;
#[cfg(test)]
mod tests;

const MAX_DOCUMENT_BYTES: u64 = 80 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct DocumentNode {
    pub id: String,
    pub kind: String,
    pub text: String,
    pub children: Vec<DocumentNode>,
    pub properties: serde_json::Map<String, Value>,
}

#[derive(Clone, Serialize)]
pub struct DocumentSnapshot {
    pub id: String,
    pub scope: String,
    pub path: String,
    pub name: String,
    pub kind: String,
    pub version: String,
    pub size: u64,
    pub text: Option<String>,
    pub image_url: Option<String>,
    pub nodes: Vec<DocumentNode>,
    pub warnings: Vec<String>,
    pub can_edit: bool,
    pub can_undo: bool,
    pub can_redo: bool,
    pub dirty: bool,
}

struct OpenDocument { snapshot: DocumentSnapshot, bytes: Vec<u8>, disk_version: String, undo: Vec<Vec<u8>>, redo: Vec<Vec<u8>> }
static DOCUMENTS: OnceLock<Mutex<HashMap<String, OpenDocument>>> = OnceLock::new();
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
pub fn initialize(app:tauri::AppHandle){let _=APP.set(app);}
fn documents() -> &'static Mutex<HashMap<String, OpenDocument>> { DOCUMENTS.get_or_init(|| Mutex::new(HashMap::new())) }
fn error(message: impl Into<String>) -> AppError { AppError::Project(message.into()) }
pub fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

fn read_bytes(path: &Path) -> Result<Vec<u8>, AppError> {
    let metadata = fs::metadata(path).map_err(|e| error(format!("无法打开文件：{e}")))?;
    if !metadata.is_file() { return Err(error("请选择一个文件；文件夹请从项目列表打开。")); }
    if metadata.len() > MAX_DOCUMENT_BYTES { return Err(error("文件超过 80 MiB，请用默认应用打开。")); }
    fs::read(path).map_err(|e| error(format!("读取文件未完成：{e}")))
}

/// 剪贴板二进制附件保存为本软件的工作副本，不能用提取的正文冒充原 Office 文件。
fn attachment_path(attachment: &Value) -> Result<PathBuf, AppError> {
    if let Some(path) = attachment.get("sourcePath").and_then(Value::as_str).filter(|s| !s.is_empty()) { return Ok(PathBuf::from(path)); }
    let name = attachment.get("name").and_then(Value::as_str).unwrap_or("attachment.txt");
    let safe_name: String = name.chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c }).collect();
    let bytes = if let Some(encoded) = attachment.get("dataBase64").and_then(Value::as_str) {
        if encoded.len() > (MAX_DOCUMENT_BYTES as usize) * 2 { return Err(error("附件超过预览上限。")); }
        STANDARD.decode(encoded).map_err(|_| error("附件数据无法解码，请重新附加原文件。"))?
    } else {
        let extension = Path::new(name).extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        if matches!(extension.as_str(), "docx" | "xlsx" | "pptx" | "pdf") { return Err(error("这条旧附件只保留了提取文本，请重新附加原文件以编辑。")); }
        attachment.get("textContent").and_then(Value::as_str).ok_or_else(|| error("附件没有原始文件数据，请重新添加。"))?.as_bytes().to_vec()
    };
    if bytes.len() > MAX_DOCUMENT_BYTES as usize { return Err(error("附件超过预览上限。")); }
    let directory = app_data_root().join("documents").join("attachments").join(digest(&bytes));
    fs::create_dir_all(&directory).map_err(|e| error(e.to_string()))?;
    let path = directory.join(if safe_name.trim_matches('.').trim().is_empty() { "attachment.txt" } else { &safe_name });
    if !path.exists() { fs::write(&path, bytes).map_err(|e| error(e.to_string()))?; }
    Ok(path)
}

fn decode_text(bytes: &[u8]) -> Result<String, AppError> {
    if bytes.len() > MAX_TEXT_BYTES { return Err(error("文本超过 4 MiB，请用默认应用查看。")); }
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let little = bytes[0] == 0xff;
        let words: Vec<u16> = bytes[2..].chunks_exact(2).map(|p| if little { u16::from_le_bytes([p[0], p[1]]) } else { u16::from_be_bytes([p[0], p[1]]) }).collect();
        return String::from_utf16(&words).map_err(|_| error("文本编码不可读取，请使用默认应用。"));
    }
    let text = std::str::from_utf8(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes)).map_err(|_| error("不是可预览的 UTF-8/UTF-16 文本，请使用默认应用。"))?;
    if text.contains('\0') { return Err(error("这个二进制文件暂不支持预览，请使用默认应用。")); }
    Ok(text.to_string())
}

fn snapshot(path: &Path, bytes: &[u8], scope: String) -> Result<DocumentSnapshot, AppError> {
    let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    let image_mime = match extension.as_str() { "png" => Some("image/png"), "jpg" | "jpeg" => Some("image/jpeg"), "gif" => Some("image/gif"), "webp" => Some("image/webp"), "bmp" => Some("image/bmp"), "svg" => Some("image/svg+xml"), _ => None };
    let kind = if image_mime.is_some() { "image" } else if matches!(extension.as_str(), "docx" | "xlsx" | "pptx" | "pdf") { &extension } else if matches!(extension.as_str(), "html" | "htm") { "html" } else { "text" };
    let text = if matches!(kind, "text" | "html") { Some(decode_text(bytes)?) } else { None };
    let nodes=match kind {"docx"=>docx::read(&mut ooxml::Package::open(bytes)?)?,"xlsx"=>xlsx::read(&mut ooxml::Package::open(bytes)?)?,"pptx"=>pptx::read(&mut ooxml::Package::open(bytes)?)?,"pdf"=>pdf::read(bytes)?,_=>vec![]};
    let warnings=match kind {"html"=>vec!["HTML 在隔离预览中展示；脚本、表单、嵌入页面和页面跳转已禁用。".into()],"docx"=>vec!["按文档结构展示；复杂分页、浮动对象和修订保留在原文件中。".into()],"xlsx"=>vec!["公式按原式保存；修改后由 Excel 重新计算，当前视图不冒充已重算的结果。".into()],"pptx"=>vec!["预览展示文本与图片；主题继承、动画等未编辑对象保留在原文件。".into()],_=>vec![]};
    Ok(DocumentSnapshot { id: uuid::Uuid::new_v4().to_string(), scope, path: path.to_string_lossy().into_owned(), name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(), kind: kind.to_string(), version: digest(bytes), size: bytes.len() as u64, text, image_url: image_mime.map(|mime| format!("data:{mime};base64,{}", STANDARD.encode(bytes))), nodes, warnings, can_edit: matches!(kind,"docx"|"xlsx"|"pptx"|"pdf"), can_undo: false, can_redo: false,dirty:false })
}

#[tauri::command]
pub async fn document_open(scope: String, path: Option<String>, attachment: Option<Value>) -> Result<DocumentSnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = match (path, attachment) { (Some(p), _) => PathBuf::from(p), (_, Some(a)) => attachment_path(&a)?, _ => return Err(error("没有选择文件。")) };
        let path = dunce::canonicalize(path).map_err(|e| error(format!("文件已移动或不可访问：{e}")))?;
        let bytes = read_bytes(&path)?;
        let result = snapshot(&path, &bytes, scope)?;
        let mut store = documents().lock().map_err(|_| error("文件工作区锁不可用，请重启软件。"))?;
        if let Some(existing) = store.values().find(|d| d.snapshot.scope == result.scope && d.snapshot.path == result.path) { return Ok(existing.snapshot.clone()); }
        if store.len() >= 24 || store.values().map(|d|d.bytes.len()).sum::<usize>()+bytes.len()>256*1024*1024 { return Err(error("文件工作区已达到缓存上限，请先关闭不再使用的标签。")); }
        store.insert(result.id.clone(), OpenDocument { snapshot: result.clone(),bytes,disk_version:result.version.clone(),undo:vec![],redo:vec![] });
        Ok(result)
    }).await.map_err(|e| error(e.to_string()))?
}

#[tauri::command]
pub fn document_close(id: String, scope: String) -> Result<(), AppError> {
    let mut store = documents().lock().map_err(|_| error("文件工作区不可用。"))?;
    if store.get(&id).is_some_and(|d| d.snapshot.scope == scope) { store.remove(&id); }
    Ok(())
}

#[tauri::command]
pub async fn document_pick() -> Result<Option<String>, AppError> {
    Ok(rfd::AsyncFileDialog::new().set_title("打开文件到 PLC Pilot").pick_file().await.map(|f| f.path().to_string_lossy().into_owned()))
}

fn notify(snapshot:&DocumentSnapshot){if let Some(app)=APP.get(){let _=app.emit("document-changed",serde_json::json!({"id":snapshot.id,"scope":snapshot.scope,"version":snapshot.version}));}}
fn refresh(entry:&mut OpenDocument)->Result<(),AppError>{
    let mut updated=snapshot(Path::new(&entry.snapshot.path),&entry.bytes,entry.snapshot.scope.clone())?;
    updated.id=entry.snapshot.id.clone();updated.can_undo=!entry.undo.is_empty();updated.can_redo=!entry.redo.is_empty();updated.dirty=updated.version!=entry.disk_version;
    entry.snapshot=updated;Ok(())
}
fn trim_history(history:&mut Vec<Vec<u8>>){while history.len()>12 || (history.len()>1 && history.iter().map(Vec::len).sum::<usize>()>48*1024*1024){history.remove(0);}}
fn atomic_save(path:&Path,expected:&str,bytes:&[u8])->Result<(),AppError>{
    if digest(&read_bytes(path)?)!=expected{return Err(error("原文件已被其他程序修改，本次没有覆盖。请先保存副本并重新打开。"));}
    use std::io::Write;
    let mut temporary=tempfile::NamedTempFile::new_in(path.parent().ok_or_else(||error("文件没有父目录。"))?).map_err(|e|error(e.to_string()))?;
    temporary.write_all(bytes).map_err(|e|error(e.to_string()))?;temporary.as_file().sync_all().map_err(|e|error(e.to_string()))?;
    temporary.persist(path).map_err(|e|error(format!("文件可能正被 Office 占用，请关闭后再保存：{e}")))?;Ok(())
}

#[tauri::command]
pub fn document_get(id:String,scope:String)->Result<DocumentSnapshot,AppError>{
    let store=documents().lock().map_err(|_|error("文件工作区不可用。"))?;
    store.get(&id).filter(|d|d.snapshot.scope==scope).map(|d|d.snapshot.clone()).ok_or_else(||error("文件标签已关闭，请重新打开。"))
}

#[tauri::command]
pub async fn document_apply(id:String,scope:String,version:String,operations:Vec<DocumentOperation>)->Result<DocumentSnapshot,AppError>{
    tauri::async_runtime::spawn_blocking(move||{
        let mut store=documents().lock().map_err(|_|error("文件工作区不可用。"))?;
        let entry=store.get_mut(&id).filter(|d|d.snapshot.scope==scope).ok_or_else(||error("文件标签已关闭。"))?;
        if entry.snapshot.version!=version{return Err(error("文档已变化，请刷新选区后重新修改。"));}
        let bytes=patch::apply(&entry.bytes,&entry.snapshot.kind,&entry.snapshot.nodes,&operations)?;
        // 完整解析成功后才替换工作副本，失败的批次不产生半成品。
        snapshot(Path::new(&entry.snapshot.path),&bytes,scope)?;
        entry.undo.push(std::mem::replace(&mut entry.bytes,bytes));trim_history(&mut entry.undo);entry.redo.clear();refresh(entry)?;
        notify(&entry.snapshot);Ok(entry.snapshot.clone())
    }).await.map_err(|e|error(e.to_string()))?
}

#[tauri::command]
pub async fn document_save(id:String,scope:String,version:String)->Result<DocumentSnapshot,AppError>{
    tauri::async_runtime::spawn_blocking(move||{
        let mut store=documents().lock().map_err(|_|error("文件工作区不可用。"))?;
        let entry=store.get_mut(&id).filter(|d|d.snapshot.scope==scope).ok_or_else(||error("文件标签已关闭。"))?;
        if entry.snapshot.version!=version{return Err(error("工作副本版本已变化，保存已停止。"));}
        let path=Path::new(&entry.snapshot.path);
        atomic_save(path,&entry.disk_version,&entry.bytes)?;
        entry.disk_version=entry.snapshot.version.clone();entry.snapshot.dirty=false;notify(&entry.snapshot);Ok(entry.snapshot.clone())
    }).await.map_err(|e|error(e.to_string()))?
}

#[tauri::command]
pub async fn document_history(id:String,scope:String,version:String,redo:bool)->Result<DocumentSnapshot,AppError>{
    tauri::async_runtime::spawn_blocking(move||{
        let mut store=documents().lock().map_err(|_|error("文件工作区不可用。"))?;
        let entry=store.get_mut(&id).filter(|d|d.snapshot.scope==scope).ok_or_else(||error("文件标签已关闭。"))?;
        if entry.snapshot.version!=version{return Err(error("文档已变化，请等待当前修改完成。"));}
        let previous=if redo{entry.redo.pop()}else{entry.undo.pop()}.ok_or_else(||error("没有可撤回的记录。"))?;
        let current=std::mem::replace(&mut entry.bytes,previous);
        if redo{entry.undo.push(current)}else{entry.redo.push(current)};
        refresh(entry)?;notify(&entry.snapshot);Ok(entry.snapshot.clone())
    }).await.map_err(|e|error(e.to_string()))?
}

#[tauri::command]
pub async fn document_cache_attachment(attachment:Value)->Result<String,AppError>{
    tauri::async_runtime::spawn_blocking(move||attachment_path(&attachment).map(|p|p.to_string_lossy().into_owned())).await.map_err(|e|error(e.to_string()))?
}

pub async fn refresh_from_disk(id:&str,scope:&str)->Result<DocumentSnapshot,AppError>{
    let mut store=documents().lock().map_err(|_|error("文件工作区不可用。"))?;
    let entry=store.get_mut(id).filter(|d|d.snapshot.scope==scope).ok_or_else(||error("文件标签已关闭。"))?;
    let bytes=read_bytes(Path::new(&entry.snapshot.path))?;let mut next=snapshot(Path::new(&entry.snapshot.path),&bytes,scope.to_string())?;next.id=entry.snapshot.id.clone();entry.undo.push(std::mem::replace(&mut entry.bytes,bytes));trim_history(&mut entry.undo);entry.redo.clear();next.can_undo=!entry.undo.is_empty();entry.disk_version=next.version.clone();entry.snapshot=next;notify(&entry.snapshot);Ok(entry.snapshot.clone())
}

#[tauri::command]
pub async fn document_render_page(id:String,scope:String,version:String,page:u16,width:i32)->Result<String,AppError>{
    tauri::async_runtime::spawn_blocking(move||{
        let bytes={let store=documents().lock().map_err(|_|error("文件工作区不可用。"))?;
            let entry=store.get(&id).filter(|d|d.snapshot.scope==scope&&d.snapshot.version==version).ok_or_else(||error("页面版本已变化。"))?;
            if entry.snapshot.kind!="pdf"{return Err(error("当前文件不是 PDF。"));} entry.bytes.clone()};
        pdf::render(&bytes,page,width)
    }).await.map_err(|e|error(e.to_string()))?
}
