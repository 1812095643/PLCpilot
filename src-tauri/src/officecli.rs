use super::*;
use serde_json::{json,Value};
use std::{fs,path::PathBuf};
use tokio::process::Command;
use tokio::time::timeout;
use sha2::Digest;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub const OFFICECLI_VERSION:&str="1.0.152";
const OFFICECLI_URL:&str="https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.152/officecli-win-x64.exe";
const OFFICECLI_SHA256:&str="047705402974c3690a4437e55f620d03afac4beba4fdd28fdb59af610a3afff2";

#[derive(Clone,Serialize,Deserialize,Default)]
pub struct OfficeCliPreferences { #[serde(default="default_engine")] pub mode:String }
fn default_engine()->String{"auto".into()}
#[derive(Clone,Serialize)]
pub struct OfficeCliStatus { pub mode:String,pub installed:bool,pub version:Option<String>,pub path:Option<String>,pub size:u64,pub latest_version:String }
fn config_path()->PathBuf{app_data_root().join("officecli.json")}
fn root()->PathBuf{app_data_root().join("components").join("officecli").join(OFFICECLI_VERSION)}
fn executable()->PathBuf{root().join(if cfg!(windows){"officecli.exe"}else{"officecli"})}
pub fn preferences()->OfficeCliPreferences{fs::read(config_path()).ok().and_then(|bytes|serde_json::from_slice(&bytes).ok()).unwrap_or_default()}
pub fn preferred_engine()->String{preferences().mode}
pub fn enabled()->bool{matches!(preferred_engine().as_str(),"officecli")&&executable().is_file()}
fn status()->OfficeCliStatus{let path=executable();OfficeCliStatus{mode:preferred_engine(),installed:path.is_file(),version:path.is_file().then(||OFFICECLI_VERSION.into()),path:path.is_file().then(||path.to_string_lossy().into_owned()),size:path.metadata().map(|m|m.len()).unwrap_or(0),latest_version:OFFICECLI_VERSION.into()}}
#[tauri::command]
pub async fn get_officecli_status()->Result<OfficeCliStatus,AppError>{Ok(status())}
#[tauri::command(rename_all="snake_case")]
pub async fn set_office_engine_mode(mode:String)->Result<OfficeCliStatus,AppError>{
    if !matches!(mode.as_str(),"native"|"auto"|"officecli"){return Err(AppError::Configuration("文件引擎只能是 PLC Pilot 原生、自动选择或 OfficeCLI。".into()));}
    let settings=OfficeCliPreferences{mode};write_json_atomic(&config_path(),&settings,"OfficeCLI 设置")?;Ok(status())
}
#[tauri::command]
pub async fn install_officecli()->Result<OfficeCliStatus,AppError>{
    if executable().is_file(){return Ok(status());}
    let client=reqwest::Client::builder().timeout(std::time::Duration::from_secs(180)).build().map_err(|e|AppError::Network(e.to_string()))?;
    let response=client.get(OFFICECLI_URL).send().await.map_err(|e|AppError::Network(format!("下载 OfficeCLI 未完成：{e}")))?;
    if !response.status().is_success(){return Err(AppError::Network(format!("下载 OfficeCLI 返回 HTTP {}",response.status())));}
    let bytes=response.bytes().await.map_err(|e|AppError::Network(e.to_string()))?;
    if bytes.len()>64*1024*1024{return Err(AppError::Configuration("OfficeCLI 下载文件超过安全上限。".into()));}
    if format!("{:x}",sha2::Sha256::digest(&bytes))!=OFFICECLI_SHA256{return Err(AppError::Configuration("OfficeCLI SHA-256 校验不一致，安装已停止。".into()));}
    fs::create_dir_all(root()).map_err(|e|AppError::Configuration(e.to_string()))?;
    let temporary=root().join(format!("officecli.{}.tmp",Uuid::new_v4()));fs::write(&temporary,&bytes).map_err(|e|AppError::Configuration(e.to_string()))?;
    if let Err(e)=fs::rename(&temporary,executable()){let _=fs::remove_file(&temporary);return Err(AppError::Configuration(format!("安装 OfficeCLI 未完成：{e}")));}
    let _=set_office_engine_mode("auto".into()).await?;Ok(status())
}
#[tauri::command]
pub async fn uninstall_officecli()->Result<OfficeCliStatus,AppError>{
    let parent=app_data_root().join("components").join("officecli");if parent.exists(){fs::remove_dir_all(&parent).map_err(|e|AppError::Configuration(format!("卸载 OfficeCLI 未完成：{e}")))?;}let _=set_office_engine_mode("native".into()).await?;Ok(status())
}

async fn run(arguments:&[String])->Result<Value,AppError>{
    if !executable().is_file(){return Err(AppError::Configuration("OfficeCLI 尚未安装，请到设置中一键安装。".into()));}
    let mut command=Command::new(executable());command.args(arguments).arg("--json");
    #[cfg(windows)] command.creation_flags(CREATE_NO_WINDOW);
    let output=timeout(std::time::Duration::from_secs(300),command.output()).await.map_err(|_|AppError::Mcp("OfficeCLI 超过 5 分钟仍未返回。".into()))?.map_err(|e|AppError::Mcp(format!("启动 OfficeCLI 未完成：{e}")))?;
    let stdout=String::from_utf8_lossy(&output.stdout).trim().to_string();let stderr=String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success(){return Err(AppError::Mcp(if !stderr.is_empty(){stderr}else if !stdout.is_empty(){stdout}else{format!("OfficeCLI 退出码 {:?}",output.status.code())}));}
    if stdout.is_empty(){return Ok(json!({"success":true,"output":""}));}
    match serde_json::from_str::<Value>(&stdout) { Ok(value) => Ok(value), Err(_) => Ok(json!({"success":true,"output":stdout})) }
}
fn path_args(file:&str)->Result<Vec<String>,AppError>{let path=dunce::canonicalize(file).map_err(|e|AppError::Project(format!("OfficeCLI 文件不可访问：{e}")))?;if !path.is_file(){return Err(AppError::Project("OfficeCLI 只接受普通文件。".into()));}Ok(vec![path.to_string_lossy().into_owned()])}
#[derive(Clone,Serialize,Deserialize)]pub struct OfficeCliToolRequest{pub file:String,pub operation:String,#[serde(default)]pub path:Option<String>,#[serde(default)]pub selector:Option<String>,#[serde(default)]pub view:Option<String>,#[serde(default)]pub props:serde_json::Map<String,Value>}
pub fn tool()->McpTool{McpTool{server_id:BUILTIN_SERVER_ID.into(),name:"officecli".into(),description:Some("使用已安装的 OfficeCLI 处理 DOCX/XLSX/PPTX。必须传 file 和 operation；只允许 view/get/query/read-only 或 set/add/remove/move/swap/batch 写入。写入仍走 PLC Pilot 审批。OfficeCLI 不处理 PDF，PDF 使用 PLC Pilot 原生引擎。".into()),input_schema:json!({"type":"object","properties":{"file":{"type":"string"},"operation":{"type":"string","enum":["view","get","query","set","add","remove","move","swap","batch","validate"]},"path":{"type":"string"},"selector":{"type":"string"},"view":{"type":"string"},"props":{"type":"object"}},"required":["file","operation"],"additionalProperties":false})}}
pub fn is_mutating(operation:&str)->bool{matches!(operation,"set"|"add"|"remove"|"move"|"swap"|"batch")}
pub fn request_requires_approval(arguments:&Value)->bool{arguments.get("operation").and_then(Value::as_str).map(is_mutating).unwrap_or(true)}
pub async fn call(request:OfficeCliToolRequest)->Result<ToolCallResult,AppError>{
    let mut args=path_args(&request.file)?;args.push(request.operation.clone());
    if let Some(path)=request.path{args.push(path)}else if let Some(selector)=request.selector{args.push(selector)}
    if let Some(view)=request.view{args.push(view)}
    for(key,value)in request.props{args.push("--prop".into());args.push(format!("{}={}",key,value.as_str().map(str::to_string).unwrap_or_else(||value.to_string())));}
    Ok(json_content(&run(&args).await?,false))
}
pub async fn batch(file:&str,commands:Value)->Result<ToolCallResult,AppError>{let mut args=path_args(file)?;args.extend(["batch".into(),"--commands".into(),serde_json::to_string(&commands).map_err(|e|AppError::Mcp(e.to_string()))?]);Ok(json_content(&run(&args).await?,false))}

pub async fn propose(state:&AppState,mut arguments:Value)->Result<PendingChangeSummary,AppError>{
    let operation=arguments.get("operation").and_then(Value::as_str).unwrap_or_default().to_string();if !is_mutating(&operation){return Err(AppError::Configuration("只读 OfficeCLI 操作不应生成审批动作。".into()));}
    let requested=arguments.get("file").and_then(Value::as_str).ok_or_else(||AppError::Project("OfficeCLI 缺少 file。".into()))?;
    let path=dunce::canonicalize(requested).map_err(|e|AppError::Project(format!("OfficeCLI 文件不可访问：{e}")))?;
    let project=state.inner.lock().await.project.clone();
    if let Some(root)=project.working_directory.as_deref().or(project.project_directory.as_deref()){
        let root=dunce::canonicalize(root).unwrap_or_else(|_|PathBuf::from(root));if !path.starts_with(&root){return Err(AppError::Project("OfficeCLI 只能访问当前工作目录内的文件。".into()));}
    }
    let bytes=fs::read(&path).map_err(|e|AppError::Project(e.to_string()))?;arguments["file"]=json!(path.to_string_lossy());arguments["expected_sha256"]=json!(format!("{:x}",sha2::Sha256::digest(&bytes)));
    let id=Uuid::new_v4().to_string();let summary=PendingChangeSummary{id:id.clone(),title:format!("OfficeCLI {}",operation),description:format!("{} · {} 字节 · OfficeCLI {}",path.file_name().unwrap_or_default().to_string_lossy(),bytes.len(),OFFICECLI_VERSION),diff:format!("文件：{}\n操作：{}\n参数：{}\n\n批准后通过 OfficeCLI 原子执行，并复核文件未被外部修改。",path.display(),operation,serde_json::to_string_pretty(&arguments).unwrap_or_default()),server_id:BUILTIN_SERVER_ID.into(),tool_name:"officecli".into(),risk:"OfficeCLI 将修改本地 Office 文件，需要人工审批。".into(),status:"pending".into()};let pending=PendingChange{summary:summary.clone(),arguments};state.inner.lock().await.pending.insert(id.clone(),pending.clone());state.approvals.lock().await.insert(id,pending);Ok(summary)
}
pub async fn apply_pending(pending:&PendingChange)->Result<ToolCallResult,AppError>{
    let expected=pending.arguments.get("expected_sha256").and_then(Value::as_str).unwrap_or("");let path=pending.arguments.get("file").and_then(Value::as_str).ok_or_else(||AppError::Project("OfficeCLI 审批缺少 file。".into()))?;let current=fs::read(path).map_err(|e|AppError::Project(e.to_string()))?;if format!("{:x}",sha2::Sha256::digest(&current))!=expected{return Err(AppError::Project("OfficeCLI 审批等待期间文件已变化，未执行写入。".into()));}
    let request:OfficeCliToolRequest=serde_json::from_value(pending.arguments.clone()).map_err(|e|AppError::Configuration(e.to_string()))?;call(request).await
}

pub async fn apply_document_operations(file:&str,kind:&str,nodes:&[crate::document_core::DocumentNode],operations:&[crate::document_core::DocumentOperation])->Result<ToolCallResult,AppError>{
    if !enabled(){return Err(AppError::Configuration("当前文档引擎选择了 OfficeCLI，但 OfficeCLI 尚未安装。请到设置中安装，或切回 PLC Pilot 原生引擎。".into()));}
    let mut commands=Vec::new();
    for operation in operations {
        match operation {
            crate::document_core::DocumentOperation::ReplaceText{target,after,..}=>{
                let node=crate::document_core::patch::find_node(nodes,target).ok_or_else(||AppError::Project("OfficeCLI 文档对象已变化，请重新读取。".into()))?;
                let path=if kind=="docx"{let index=node.properties.get("index").and_then(Value::as_u64).ok_or_else(||AppError::Project("Word 段落索引不可用。".into()))?;format!("/body/p[{}]",index+1)}else if kind=="pptx"{let part=node.properties.get("part").and_then(Value::as_str).unwrap_or("");let slide=part.split("slide").nth(1).and_then(|v|v.split('.').next()).unwrap_or("1");let index=node.properties.get("index").and_then(Value::as_u64).unwrap_or(0);format!("/slide[{slide}]/shape[{}]",index+1)}else{return Err(AppError::Configuration("OfficeCLI 只接管 Word 段落和 PPT 文本框修改；Excel 请使用单元格操作。".into()))};
                commands.push(json!({"command":"set","path":path,"props":{"text":after}}));
            }
            crate::document_core::DocumentOperation::SetCell{sheet,address,value,formula}=>{
                let sheet_node=nodes.iter().find(|node|node.id==*sheet||node.text==*sheet).ok_or_else(||AppError::Project("Excel 工作表对象已变化，请重新读取。".into()))?;
                let mut props=serde_json::Map::new();if let Some(formula)=formula{props.insert("formula".into(),json!(formula.trim_start_matches('=')));}else{props.insert("value".into(),json!(match value{Value::Null=>"".into(),Value::String(v)=>v.clone(),_=>value.to_string()}));}
                commands.push(json!({"command":"set","path":format!("/{}/{}",sheet_node.text,address),"props":props}));
            }
            crate::document_core::DocumentOperation::ReplaceImage{..}=>return Err(AppError::Configuration("OfficeCLI 当前不接管图片替换，请切回 PLC Pilot 原生引擎完成图片操作。".into())),
        }
    }
    if commands.is_empty(){return Err(AppError::Configuration("没有可转换为 OfficeCLI 的修改操作。".into()));}
    batch(file,json!(commands)).await
}
