//! 聊天与生图工作台共用请求、取消、官方参数校验和实时图片事件。
use super::*;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use reqwest::multipart::{Form, Part};
use crate::image_parameters::ImageCapabilities;

#[derive(Clone, Serialize, Deserialize)]
pub struct ImageModel {
    pub id: String, pub provider_id: String, pub model: String,
    #[serde(default = "image_protocol")] pub protocol: String,
    #[serde(default)] pub request_model: Option<String>,
    #[serde(default = "image_auto")] pub size: String,
    #[serde(default = "image_auto")] pub quality: String,
    #[serde(default)] pub streaming: bool,
    #[serde(default = "default_model_enabled")] pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub parameters: Option<ImageCapabilities>,
}
fn image_protocol() -> String { "images".into() }
fn image_auto() -> String { "auto".into() }

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct ImageSettings {
    #[serde(default)] pub models: Vec<ImageModel>,
    #[serde(default)] pub default_id: String,
}
fn config_path() -> PathBuf { app_data_root().join("image-models.json") }

pub(crate) fn read_settings() -> Result<ImageSettings, AppError> {
    if !config_path().exists() { return Ok(ImageSettings::default()); }
    let mut settings: ImageSettings = serde_json::from_slice(&fs::read(config_path()).map_err(|e| AppError::Configuration(e.to_string()))?)
        .map_err(|e| AppError::Configuration(format!("生图模型配置无法读取：{e}")))?;
    // 旧版对所有模型开放了 xhigh/max；读取时恢复该模型允许的默认值，避免升级后仍发送错误参数。
    for model in &mut settings.models {
        let caps = image_parameters::for_model(&model.model, model.parameters.as_ref());
        if !caps.qualities.contains(&model.quality) { model.quality = caps.qualities.first().cloned().unwrap_or_else(image_auto); }
        if image_parameters::validate(&caps, &model.size, &model.quality).is_err() { model.size = caps.sizes.first().cloned().unwrap_or_else(image_auto); }
        model.parameters = Some(caps);
    }
    Ok(settings)
}

#[tauri::command]
pub fn get_image_settings() -> Result<ImageSettings, AppError> { read_settings() }

#[tauri::command]
pub async fn save_image_settings(mut settings: ImageSettings, state: State<'_, AppState>) -> Result<ImageSettings, AppError> {
    if settings.models.len() > 64 { return Err(AppError::Configuration("生图模型最多配置 64 个。".into())); }
    let runtime = state.inner.lock().await;
    let mut ids = HashSet::new();
    let mut models = HashSet::new();
    for model in &mut settings.models {
        model.model = model.model.trim().to_string();
        if model.id.is_empty() { model.id = Uuid::new_v4().to_string(); }
        if !ids.insert(model.id.clone()) || model.model.is_empty() || model.model.len() > 200 { return Err(AppError::Configuration("请填写唯一配置和有效生图模型 ID。".into())); }
        if !models.insert((model.provider_id.clone(), model.model.clone(), model.protocol.clone())) { return Err(AppError::Configuration("此服务商已经添加了相同协议的生图模型。".into())); }
        if !runtime.model_providers.iter().any(|p| p.id == model.provider_id) { return Err(AppError::Configuration("生图服务商已不存在，请重新选择。".into())); }
        if !matches!(model.protocol.as_str(), "images" | "responses") { return Err(AppError::Configuration("生图协议仅支持 Images 或 Responses。".into())); }
        if model.protocol == "responses" && model.request_model.as_deref().is_none_or(|value| value.trim().is_empty()) { return Err(AppError::Configuration("Responses 生图需要选择负责调用工具的对话模型。".into())); }
        let caps = image_parameters::for_model(&model.model, model.parameters.as_ref());
        image_parameters::validate(&caps, &model.size, &model.quality)?;
        model.parameters = Some(caps);
    }
    if !settings.models.iter().any(|model| model.id == settings.default_id && model.enabled) { settings.default_id = settings.models.iter().find(|model| model.enabled).map(|model| model.id.clone()).unwrap_or_default(); }
    write_json_atomic(&config_path(), &settings, "生图模型")?;
    Ok(settings)
}

pub fn tool() -> McpTool {
    McpTool {
        server_id: BUILTIN_SERVER_ID.into(), name: "image_gen".into(),
        description: Some("生成或编辑真实图片，复用已配置服务商的 URL 和 Key。参考图片通过 referenced_image_paths 传入，有参考图时调用改图接口。model_id 是生图配置 ID；size、quality 必须符合该模型官方参数。结果保存在工作区 output/imagegen，返回可点击的文件路径，支持实时中间图和停止；不因等待时间过长自动取消。".into()),
        input_schema: json!({"type":"object","properties":{"prompt":{"type":"string"},"referenced_image_paths":{"type":"array","maxItems":8,"items":{"type":"string"}},"model_id":{"type":"string"},"size":{"type":"string"},"quality":{"type":"string"}},"required":["prompt"],"additionalProperties":false}),
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ImageProgress {
    pub id: String, pub scope: String, pub status: String, pub model: String, pub model_id: String,
    pub provider_id: String, pub prompt: String, pub size: String, pub quality: String,
    pub started_at: String, pub finished_at: Option<String>, pub duration_ms: u64,
    #[serde(default)] pub referenced_image_paths: Vec<String>,
    pub width: Option<u32>, pub height: Option<u32>, pub thumbnail_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub error: Option<String>,
}
pub(crate) fn publish(app: &AppHandle, value: &ImageProgress) { let _ = app.emit("image-generation", value); }
fn image_error(message: impl Into<String>) -> AppError { AppError::Network(message.into()) }

/// 聊天停止会丢弃整个工具 Future，仍需收尾图片卡片与历史，不能遗留永久加载状态。
struct ImageCompletion {
    app: AppHandle,
    progress: ImageProgress,
    started: std::time::Instant,
    finished: bool,
}
impl Drop for ImageCompletion {
    fn drop(&mut self) {
        if self.finished { return; }
        self.progress.status = "cancelled".into();
        self.progress.error = Some("图片生成已停止。".into());
        self.progress.finished_at = Some(now_iso());
        self.progress.duration_ms = self.started.elapsed().as_millis() as u64;
        if let Err(error) = image_studio::persist(&self.progress) { diagnostics::warn("image.history", json!({"id": self.progress.id, "error": error.to_string()})); }
        publish(&self.app, &self.progress);
    }
}

pub(crate) fn prepare(args: &Value, scope: &str, id: String) -> Result<(ImageModel, ImageProgress), AppError> {
    let settings = read_settings()?;
    let selected = args["model_id"].as_str().filter(|value| !value.is_empty()).unwrap_or(&settings.default_id);
    let model = settings.models.iter().find(|model| model.id == selected && model.enabled)
        .ok_or_else(|| image_error("请先在设置 → 模型中添加并启用生图模型。"))?.clone();
    let prompt = args["prompt"].as_str().map(str::trim).filter(|value| !value.is_empty() && value.chars().count() <= 32000)
        .ok_or_else(|| image_error("请提供 1–32000 个字符的生图说明。"))?;
    let size = args["size"].as_str().unwrap_or(&model.size).to_string();
    let quality = args["quality"].as_str().unwrap_or(&model.quality).to_string();
    image_parameters::validate(&image_parameters::for_model(&model.model, model.parameters.as_ref()), &size, &quality)?;
    let references = match args.get("referenced_image_paths") {
        None | Some(Value::Null) => Vec::new(),
        Some(value) => serde_json::from_value::<Vec<String>>(value.clone()).map_err(|_| image_error("参考图片路径应为文件路径列表。"))?,
    };
    if references.len() > 8 { return Err(image_error("参考图片最多 8 张。")); }
    let progress = ImageProgress {
        id, scope: scope.into(), status: "generating".into(), model: model.model.clone(), model_id: model.id.clone(),
        provider_id: model.provider_id.clone(), prompt: prompt.into(), size, quality, started_at: now_iso(), finished_at: None,
        duration_ms: 0, referenced_image_paths: references, width: None, height: None, thumbnail_url: None,
        image_url: None, path: None, error: None,
    };
    Ok((model, progress))
}

fn endpoint_url(base: &str, suffix: &str) -> Result<reqwest::Url, AppError> {
    let url = reqwest::Url::parse(&format!("{}/{}", base.trim_end_matches('/'), suffix)).map_err(|_| image_error("生图服务商 URL 不可用。"))?;
    if !matches!(url.scheme(), "http" | "https") { return Err(image_error("生图服务只支持 HTTP/HTTPS。")); }
    Ok(url)
}
fn base64_result(value: &Value) -> Option<String> {
    value.get("b64_json").and_then(Value::as_str).map(str::to_string)
        .or_else(|| value.get("data").and_then(Value::as_array).and_then(|items| items.first()).and_then(|item| item.get("b64_json")).and_then(Value::as_str).map(str::to_string))
        .or_else(|| value.get("output").and_then(Value::as_array).and_then(|items| items.iter().find(|item| item["type"] == "image_generation_call")).and_then(|item| item.get("result")).and_then(Value::as_str).map(str::to_string))
}
fn provider_error(value: &Value) -> AppError {
    let text = value.pointer("/error/message").or_else(|| value.pointer("/response/error/message")).or_else(|| value.get("message"))
        .and_then(Value::as_str).unwrap_or("服务未返回最终图片，请核对模型与接口支持情况。");
    let safe = diagnostics::sanitize(&json!({"message": text}));
    image_error(format!("生图服务：{}", truncate(safe["message"].as_str().unwrap_or_default(), 600)))
}

/// 沿用现有逐行 SSE 管线；收到最终图片立即结束等待，不依赖网关主动关闭连接。
fn image_event(line: &[u8], app: &AppHandle, progress: &mut ImageProgress) -> Result<Option<String>, AppError> {
    let text = std::str::from_utf8(line).map_err(|_| image_error("生图事件编码不可用。"))?.trim();
    let Some(data) = text.strip_prefix("data:").map(str::trim) else { return Ok(None); };
    if data == "[DONE]" { return Ok(None); }
    let event: Value = serde_json::from_str(data).map_err(|_| image_error("生图事件格式不正确。"))?;
    let event_type = event["type"].as_str().unwrap_or_default();
    if matches!(event_type, "error" | "response.failed" | "response.incomplete") || event.get("error").is_some_and(|value| !value.is_null()) { return Err(provider_error(&event)); }
    if event_type.ends_with("partial_image") {
        if let Some(encoded) = event["b64_json"].as_str().or_else(|| event["partial_image_b64"].as_str()) {
            progress.status = "partial".into();
            progress.image_url = Some(format!("data:image/png;base64,{encoded}"));
            publish(app, progress);
        }
    }
    if event_type == "response.completed" { return Ok(base64_result(&event["response"])); }
    if matches!(event_type, "image_generation.completed" | "image_edit.completed") { return Ok(base64_result(&event)); }
    Ok(None)
}

async fn response_image(mut response: reqwest::Response, app: &AppHandle, state: &AppState, progress: &mut ImageProgress) -> Result<String, AppError> {
    let streaming = response.headers().get("content-type").and_then(|value| value.to_str().ok()).is_some_and(|value| value.contains("text/event-stream"));
    let mut buffer = Vec::new();
    let mut total_bytes = 0usize;
    loop {
        let chunk = tokio::select! {
            result = response.chunk() => result.map_err(|_| image_error("读取生图结果时连接中断；未自动重复提交，以免重复计费。"))?,
            _ = wait_for_abort(state) => return Err(image_error("图片生成已停止。")),
        };
        let Some(chunk) = chunk else { break; };
        total_bytes += chunk.len();
        if total_bytes > 128 * 1024 * 1024 { return Err(image_error("生图返回数据过大，已停止读取。")); }
        buffer.extend_from_slice(&chunk);
        if streaming {
            while let Some(end) = buffer.iter().position(|byte| *byte == b'\n') {
                let line = buffer.drain(..=end).collect::<Vec<_>>();
                if let Some(image) = image_event(&line, app, progress)? { return Ok(image); }
            }
        }
    }
    if streaming {
        if let Some(image) = image_event(&buffer, app, progress)? { return Ok(image); }
        return Err(image_error("连接结束但没有收到最终图片；未把中间预览当作成品。"));
    }
    let value: Value = serde_json::from_slice(&buffer).map_err(|_| image_error("生图服务未返回 JSON 图片结果。"))?;
    if value.get("error").is_some_and(|value| !value.is_null()) { return Err(provider_error(&value)); }
    base64_result(&value).ok_or_else(|| image_error("服务未返回 base64 图片。请配置支持 Images/Responses 的生图模型。"))
}

fn request_options(model: &ImageModel, progress: &ImageProgress) -> Value {
    let caps = image_parameters::for_model(&model.model, model.parameters.as_ref());
    let mut options = json!({"model": model.model});
    // 未知兼容模型没有元数据时不猜测可选参数，交给服务商使用自身默认值。
    if !caps.source.is_empty() { options["size"] = json!(progress.size); options["quality"] = json!(progress.quality); }
    if model.streaming { options["partial_images"] = json!(2); }
    options
}

pub async fn generate(app: &AppHandle, state: &AppState, args: Value) -> Result<ToolCallResult, AppError> {
    let (model, progress) = prepare(&args, &state.document_scope, Uuid::new_v4().to_string())?;
    execute(app, state, model, progress).await
}

pub(crate) async fn execute(app: &AppHandle, state: &AppState, model: ImageModel, mut progress: ImageProgress) -> Result<ToolCallResult, AppError> {
    let started = std::time::Instant::now();
    let mut completion = ImageCompletion { app: app.clone(), progress: progress.clone(), started, finished: false };
    if let Err(error) = image_studio::persist(&progress) { diagnostics::warn("image.history", json!({"error": error.to_string()})); }
    publish(app, &progress);
    diagnostics::info("image.started", json!({"id": progress.id, "scope": progress.scope, "model": model.model}));
    let result = async {
        let (provider, project) = {
            let runtime = state.inner.lock().await;
            let provider = runtime.model_providers.iter().find(|provider| provider.id == model.provider_id && provider.enabled)
                .cloned().ok_or_else(|| image_error("生图服务商未启用。"))?;
            (provider, runtime.project.clone())
        };
        let key = provider.api_key.as_deref().filter(|value| !value.is_empty()).ok_or_else(|| image_error("生图服务商还没有保存 API Key。"))?;
        let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().map_err(|e| image_error(e.to_string()))?;
        let mut input_images = Vec::new();
        for path in &progress.referenced_image_paths {
            let allowed = document_core::agent::allowed_path(state, path).await?;
            if fs::metadata(&allowed).map_err(|_| image_error("参考图片无法读取。"))?.len() > 20 * 1024 * 1024 { return Err(image_error("单张参考图片超过 20 MiB。")); }
            let bytes = fs::read(&allowed).map_err(|_| image_error("参考图片无法读取。"))?;
            let format = image::guess_format(&bytes).map_err(|_| image_error("参考文件不是可读取的图片。"))?;
            if !matches!(format, image::ImageFormat::Png | image::ImageFormat::Jpeg | image::ImageFormat::WebP) { return Err(image_error("参考图片请使用 PNG、JPEG 或 WebP。")); }
            input_images.push((allowed, bytes, format.to_mime_type().to_string()));
        }
        let options = request_options(&model, &progress);
        let request = if model.protocol == "responses" {
            let request_model = model.request_model.as_deref().filter(|value| !value.is_empty()).ok_or_else(|| image_error("Responses 生图需要选择负责调用工具的对话模型。"))?;
            let mut content = vec![json!({"type":"input_text","text":progress.prompt})];
            for (_, bytes, mime) in &input_images { content.push(json!({"type":"input_image","image_url":format!("data:{mime};base64,{}", BASE64_STANDARD.encode(bytes))})); }
            let mut image_tool = options;
            image_tool["type"] = json!("image_generation");
            client.post(endpoint_url(&provider.base_url, "responses")?).json(&json!({"model":request_model,"input":[{"role":"user","content":content}],"tools":[image_tool],"tool_choice":{"type":"image_generation"},"stream":model.streaming}))
        } else if input_images.is_empty() {
            let mut payload = options;
            payload["prompt"] = json!(progress.prompt); payload["n"] = json!(1);
            if model.streaming { payload["stream"] = json!(true); }
            client.post(endpoint_url(&provider.base_url, "images/generations")?).json(&payload)
        } else {
            let mut form = Form::new().text("prompt", progress.prompt.clone());
            for (key, value) in options.as_object().unwrap() { form = form.text(key.clone(), value.as_str().map(str::to_string).unwrap_or_else(|| value.to_string())); }
            if model.streaming { form = form.text("stream", "true"); }
            for (path, bytes, mime) in input_images {
                form = form.part("image[]", Part::bytes(bytes).file_name(Path::new(&path).file_name().unwrap_or_default().to_string_lossy().into_owned()).mime_str(&mime).map_err(|e| image_error(e.to_string()))?);
            }
            client.post(endpoint_url(&provider.base_url, "images/edits")?).multipart(form)
        };
        let response = tokio::select! {
            value = request.bearer_auth(key).send() => value.map_err(|e| image_error(format!("生图连接中断：{e}。未自动重复提交，以免重复计费。")))?,
            _ = wait_for_abort(state) => return Err(image_error("图片生成已停止。")),
        };
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = tokio::select! { value = response.text() => value.unwrap_or_default(), _ = wait_for_abort(state) => return Err(image_error("图片生成已停止。")) };
            let detail = serde_json::from_str::<Value>(&body).ok().map(|value| provider_error(&value).to_string()).unwrap_or_else(|| "请核对模型、Key 和接口能力。".into());
            return Err(image_error(format!("生图服务返回 HTTP {status}：{detail}")));
        }
        let encoded = response_image(response, app, state, &mut progress).await?;
        let bytes = BASE64_STANDARD.decode(encoded).map_err(|_| image_error("生成图片的编码不可读取。"))?;
        let format = image::guess_format(&bytes).map_err(|_| image_error("服务返回的结果不是有效图片。"))?;
        let extension = match format { image::ImageFormat::Png => "png", image::ImageFormat::Jpeg => "jpg", image::ImageFormat::WebP => "webp", _ => return Err(image_error("服务返回了未支持的图片格式。")) };
        let decoded = image::load_from_memory(&bytes).map_err(|_| image_error("生成图片不完整，无法解码。"))?;
        progress.width = Some(decoded.width()); progress.height = Some(decoded.height());
        let mut thumbnail = std::io::Cursor::new(Vec::new());
        decoded.thumbnail(320, 320).write_to(&mut thumbnail, image::ImageFormat::Png).map_err(|e| image_error(e.to_string()))?;
        progress.thumbnail_url = Some(format!("data:image/png;base64,{}", BASE64_STANDARD.encode(thumbnail.into_inner())));
        let root = project.working_directory.as_deref().or(project.project_directory.as_deref()).ok_or_else(|| image_error("当前对话还没有工作目录。"))?;
        let directory = Path::new(root).join("output").join("imagegen");
        fs::create_dir_all(&directory).map_err(|e| image_error(e.to_string()))?;
        let path = directory.join(format!("image-{}.{extension}", progress.id));
        use std::io::Write;
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| image_error(e.to_string()))?;
        file.write_all(&bytes).map_err(|e| image_error(e.to_string()))?;
        progress.status = "completed".into(); progress.path = Some(path.to_string_lossy().into_owned());
        progress.image_url = Some(format!("data:{};base64,{}", format.to_mime_type(), BASE64_STANDARD.encode(&bytes)));
        Ok(json_content(&json!({"path":path.to_string_lossy(),"model":model.model,"bytes":bytes.len(),"message":"图片已生成并保存，可预览、引用或插入文档。"}), false))
    }.await;
    if let Err(ref cause) = result {
        progress.status = if state.abort_requested.load(Ordering::SeqCst) { "cancelled" } else { "error" }.into();
        progress.error = Some(cause.to_string());
    }
    progress.duration_ms = started.elapsed().as_millis() as u64;
    progress.finished_at = Some(now_iso());
    if let Err(error) = image_studio::persist(&progress) { diagnostics::warn("image.history", json!({"id":progress.id,"error":error.to_string()})); }
    completion.finished = true;
    publish(app, &progress);
    diagnostics::info("image.finished", json!({"id":progress.id,"status":progress.status,"duration_ms":progress.duration_ms,"error":progress.error}));
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_final_results_without_accepting_partial_images() {
        assert_eq!(base64_result(&json!({"data":[{"b64_json":"final"}]})).as_deref(), Some("final"));
        assert_eq!(base64_result(&json!({"output":[{"type":"image_generation_call","result":"done"}]})).as_deref(), Some("done"));
        assert_eq!(base64_result(&json!({"type":"image_generation.partial_image","partial_image_b64":"preview"})), None);
    }
}
