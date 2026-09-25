//! 生图凭据仅引用已有服务商；中间图与最终图按同一任务 ID 推送。
use super::*;
use reqwest::multipart::{Form,Part};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;

#[derive(Clone,Serialize,Deserialize)]
pub struct ImageModel {
    pub id:String, pub provider_id:String, pub model:String,
    #[serde(default="image_protocol")] pub protocol:String,
    #[serde(default)] pub request_model:Option<String>,
    #[serde(default="image_auto")] pub size:String,
    #[serde(default="image_auto")] pub quality:String,
    #[serde(default)] pub streaming:bool,
    #[serde(default="default_model_enabled")] pub enabled:bool,
}
fn image_protocol()->String{"images".into()}
fn image_auto()->String{"auto".into()}
#[derive(Clone,Default,Serialize,Deserialize)]
pub struct ImageSettings { #[serde(default)] pub models:Vec<ImageModel>, #[serde(default)] pub default_id:String }
fn config_path()->PathBuf{app_data_root().join("image-models.json")}
fn read_settings()->Result<ImageSettings,AppError>{
    if !config_path().exists(){return Ok(ImageSettings::default())}
    serde_json::from_slice(&fs::read(config_path()).map_err(|e|AppError::Configuration(e.to_string()))?).map_err(|e|AppError::Configuration(format!("生图模型配置无法读取：{e}")))
}
#[tauri::command]
pub fn get_image_settings()->Result<ImageSettings,AppError>{read_settings()}
#[tauri::command]
pub async fn save_image_settings(mut settings:ImageSettings,state:State<'_,AppState>)->Result<ImageSettings,AppError>{
    if settings.models.len()>64{return Err(AppError::Configuration("生图模型最多配置 64 个。".into()));}
    let runtime=state.inner.lock().await;let mut ids=HashSet::new();
    for model in &mut settings.models{
        model.model=model.model.trim().to_string();
        if model.id.is_empty(){model.id=Uuid::new_v4().to_string();}
        if !ids.insert(model.id.clone())||model.model.is_empty()||model.model.len()>200{return Err(AppError::Configuration("请填写唯一配置和有效生图模型 ID。".into()));}
        if !runtime.model_providers.iter().any(|p|p.id==model.provider_id){return Err(AppError::Configuration("生图服务商已不存在，请重新选择。".into()));}
        if !matches!(model.protocol.as_str(),"images"|"responses"){return Err(AppError::Configuration("生图协议仅支持 Images 或 Responses。".into()));}
        if model.size.len()>30||!model.size.chars().all(|c|c.is_ascii_alphanumeric()||c=='x'){return Err(AppError::Configuration("图片尺寸应为 auto 或宽x高。".into()));}
        if !["auto","low","medium","high","xhigh","max"].contains(&model.quality.as_str()){return Err(AppError::Configuration("请选择有效的生图质量。".into()));}
    }
    if !settings.models.iter().any(|m|m.id==settings.default_id&&m.enabled){settings.default_id=settings.models.iter().find(|m|m.enabled).map(|m|m.id.clone()).unwrap_or_default();}
    write_json_atomic(&config_path(),&settings,"生图模型")?;Ok(settings)
}

pub fn tool()->McpTool{McpTool{server_id:BUILTIN_SERVER_ID.into(),name:"image_gen".into(),description:Some("生成或编辑真实图片，使用设置中的生图模型及服务商凭据。用于用户要求的照片、插画、PPT 背景与配图，不用代码绘图替代。referenced_image_paths 可传当前工作区的参考/待修改图片路径；有参考图则调用改图接口。输出保存在工作区 output/imagegen，返回路径，支持实时预览与停止。".into()),input_schema:json!({"type":"object","properties":{"prompt":{"type":"string"},"referenced_image_paths":{"type":"array","maxItems":8,"items":{"type":"string"}},"model_id":{"type":"string"},"size":{"type":"string"}},"required":["prompt"],"additionalProperties":false})}}

#[derive(Clone,Serialize)]
struct ImageProgress {id:String,scope:String,status:String,model:String,#[serde(skip_serializing_if="Option::is_none")] image_url:Option<String>,#[serde(skip_serializing_if="Option::is_none")] path:Option<String>,#[serde(skip_serializing_if="Option::is_none")] error:Option<String>}
fn publish(app:&AppHandle,value:&ImageProgress){let _=app.emit("image-generation",value);}
fn image_error(message:impl Into<String>)->AppError{AppError::Network(message.into())}

fn endpoint_url(base:&str,suffix:&str)->Result<reqwest::Url,AppError>{
    let url=reqwest::Url::parse(&format!("{}/{}",base.trim_end_matches('/'),suffix)).map_err(|_|image_error("生图服务商 URL 不可用。"))?;
    if !matches!(url.scheme(),"http"|"https"){return Err(image_error("生图服务只支持 HTTP/HTTPS。"));}Ok(url)
}
fn base64_result(value:&Value)->Option<String>{
    value.get("b64_json").and_then(Value::as_str).map(str::to_string)
        .or_else(||value.get("data").and_then(Value::as_array).and_then(|items|items.first()).and_then(|item|item.get("b64_json")).and_then(Value::as_str).map(str::to_string))
        .or_else(||value.get("output").and_then(Value::as_array).and_then(|items|items.iter().find(|item|item["type"]=="image_generation_call")).and_then(|item|item.get("result")).and_then(Value::as_str).map(str::to_string))
}

async fn response_image(mut response:reqwest::Response,app:&AppHandle,state:&AppState,progress:&mut ImageProgress)->Result<String,AppError>{
    let streaming=response.headers().get("content-type").and_then(|v|v.to_str().ok()).is_some_and(|s|s.contains("text/event-stream"));
    let mut buffer=Vec::new();let mut final_image=None;
    loop{
        if state.abort_requested.load(Ordering::SeqCst){return Err(image_error("图片生成已停止。"));}
        let chunk=tokio::select!{result=response.chunk()=>result.map_err(|_|image_error("读取生图结果时连接中断；未自动重复提交，以免重复计费。"))?,_ = state.abort_notify.notified()=>return Err(image_error("图片生成已停止。"))};
        let Some(chunk)=chunk else{break};buffer.extend_from_slice(&chunk);
        if buffer.len()>128*1024*1024{return Err(image_error("生图返回数据过大，已停止读取。"));}
        if streaming{
            while let Some(end)=buffer.iter().position(|b|*b==b'\n'){
                let line=buffer.drain(..=end).collect::<Vec<_>>();let text=std::str::from_utf8(&line).map_err(|_|image_error("生图事件编码不可用。"))?.trim();
                let Some(data)=text.strip_prefix("data:").map(str::trim) else{continue};if data=="[DONE]"{continue}
                let event:Value=serde_json::from_str(data).map_err(|_|image_error("生图事件格式不正确。"))?;
                let event_type=event["type"].as_str().unwrap_or("");
                if event_type.ends_with("partial_image"){
                    if let Some(image)=event["b64_json"].as_str().or_else(||event["partial_image_b64"].as_str()){
                        progress.status="partial".into();progress.image_url=Some(format!("data:image/png;base64,{image}"));publish(app,progress);
                    }
                }else if event_type=="image_generation.completed"||event_type=="image_edit.completed"{final_image=base64_result(&event);}
                else if event_type=="response.completed"{final_image=base64_result(&event["response"]);}
                else if event_type=="error"||event_type=="response.failed"{return Err(image_error("生图服务返回失败，请在模型设置检查接口支持情况。"));}
            }
        }
    }
    if !streaming {
        let value:Value=serde_json::from_slice(&buffer).map_err(|_|image_error("生图服务未返回 JSON 图片结果。"))?;
        final_image=base64_result(&value);
        if final_image.is_none(){return Err(image_error("服务未返回 base64 图片。请配置支持 Images/Responses 的生图模型；暂不下载不明结果 URL。"));}
    }
    final_image.ok_or_else(||image_error("连接结束但没有收到最终图片；未把中间预览当作成品。"))
}

pub async fn generate(app:&AppHandle,state:&AppState,args:Value)->Result<ToolCallResult,AppError>{
    let settings=read_settings()?;
    let selected=args["model_id"].as_str().unwrap_or(&settings.default_id);
    let model=settings.models.iter().find(|m|m.id==selected&&m.enabled).ok_or_else(||image_error("请先在设置 → 模型中添加并启用生图模型。"))?.clone();
    let (provider,project)={let runtime=state.inner.lock().await;let provider=runtime.model_providers.iter().find(|p|p.id==model.provider_id&&p.enabled).cloned().ok_or_else(||image_error("生图服务商未启用。"))?;(provider,runtime.project.clone())};
    let key=provider.api_key.as_deref().filter(|s|!s.is_empty()).ok_or_else(||image_error("生图服务商还没有保存 API Key。"))?;
    let prompt=args["prompt"].as_str().filter(|s|!s.trim().is_empty()&&s.len()<=32000).ok_or_else(||image_error("请提供 1–32000 字节的生图说明。"))?;
    let mut progress=ImageProgress{id:Uuid::new_v4().to_string(),scope:state.document_scope.clone(),status:"generating".into(),model:model.model.clone(),image_url:None,path:None,error:None};
    publish(app,&progress);
    let result=async{
        let client=reqwest::Client::builder().timeout(Duration::from_secs(600)).redirect(reqwest::redirect::Policy::none()).build().map_err(|e|image_error(e.to_string()))?;
        let references=args["referenced_image_paths"].as_array().cloned().unwrap_or_default();if references.len()>8{return Err(image_error("参考图片最多 8 张。"));}
        let mut input_images=Vec::new();
        for path in references{let path=path.as_str().ok_or_else(||image_error("参考图片路径不可用。"))?;let allowed=document_core::agent::allowed_path(state,path).await?;
            let bytes=fs::read(&allowed).map_err(|_|image_error("参考图片无法读取。"))?;if bytes.len()>20*1024*1024{return Err(image_error("单张参考图片超过 20 MiB。"));}
            let format=image::guess_format(&bytes).map_err(|_|image_error("参考文件不是可读取的图片。"))?;let mime=format.to_mime_type().to_string();input_images.push((allowed,bytes,mime));}
        let size=args["size"].as_str().unwrap_or(&model.size);
        let request=if model.protocol=="responses"{
            let request_model=model.request_model.as_deref().filter(|s|!s.is_empty()).ok_or_else(||image_error("Responses 生图还需要填写负责调用生图工具的主模型 ID。"))?;
            let mut content=vec![json!({"type":"input_text","text":prompt})];
            for(_,bytes,mime)in &input_images{content.push(json!({"type":"input_image","image_url":format!("data:{mime};base64,{}",BASE64_STANDARD.encode(bytes))}));}
            let mut image_tool=json!({"type":"image_generation","model":model.model,"size":size,"quality":model.quality});
            if model.streaming{image_tool["partial_images"]=json!(2);}
            client.post(endpoint_url(&provider.base_url,"responses")?).json(&json!({"model":request_model,"input":[{"role":"user","content":content}],"tools":[image_tool],"tool_choice":{"type":"image_generation"},"stream":model.streaming}))
        }else if input_images.is_empty(){
            let mut payload=json!({"model":model.model,"prompt":prompt,"n":1,"size":size,"quality":model.quality});
            if model.streaming{payload["stream"]=json!(true);payload["partial_images"]=json!(2);}
            client.post(endpoint_url(&provider.base_url,"images/generations")?).json(&payload)
        }else{
            let mut form=Form::new().text("model",model.model.clone()).text("prompt",prompt.to_string()).text("size",size.to_string()).text("quality",model.quality.clone());
            if model.streaming{form=form.text("stream","true").text("partial_images","2");}
            for(path,bytes,mime)in input_images{form=form.part("image[]",Part::bytes(bytes).file_name(Path::new(&path).file_name().unwrap_or_default().to_string_lossy().into_owned()).mime_str(&mime).map_err(|e|image_error(e.to_string()))?);}
            client.post(endpoint_url(&provider.base_url,"images/edits")?).multipart(form)
        };
        let response=tokio::select!{value=request.bearer_auth(key).send()=>value.map_err(|_|image_error("生图连接未完成；请检查服务商地址与网络，未自动重复计费请求。"))?,_ = state.abort_notify.notified()=>return Err(image_error("图片生成已停止。"))};
        if !response.status().is_success(){return Err(image_error(format!("生图服务返回 HTTP {}，请核对模型、Key 和接口能力。",response.status().as_u16())));}
        let encoded=response_image(response,app,state,&mut progress).await?;
        let bytes=BASE64_STANDARD.decode(encoded).map_err(|_|image_error("生成图片的编码不可读取。"))?;
        let format=image::guess_format(&bytes).map_err(|_|image_error("服务返回的结果不是有效图片。"))?;
        let extension=match format{image::ImageFormat::Png=>"png",image::ImageFormat::Jpeg=>"jpg",image::ImageFormat::WebP=>"webp",_=>return Err(image_error("服务返回了未支持的图片格式。"))};
        let root=project.working_directory.as_deref().or(project.project_directory.as_deref()).ok_or_else(||image_error("当前对话还没有工作目录。"))?;
        let directory=Path::new(root).join("output").join("imagegen");fs::create_dir_all(&directory).map_err(|e|image_error(e.to_string()))?;
        let path=directory.join(format!("image-{}.{extension}",progress.id));
        use std::io::Write;
        let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e|image_error(e.to_string()))?;file.write_all(&bytes).map_err(|e|image_error(e.to_string()))?;
        progress.status="completed".into();progress.path=Some(path.to_string_lossy().into_owned());progress.image_url=Some(format!("data:{};base64,{}",format.to_mime_type(),BASE64_STANDARD.encode(&bytes)));publish(app,&progress);
        Ok(json_content(&json!({"path":path.to_string_lossy(),"model":model.model,"bytes":bytes.len(),"message":"图片已生成并保存，可插入文档或在文件工作区查看。"}),false))
    }.await;
    if let Err(ref cause)=result{progress.status=if state.abort_requested.load(Ordering::SeqCst){"cancelled"}else{"error"}.into();progress.error=Some(cause.to_string());publish(app,&progress);}
    result
}
