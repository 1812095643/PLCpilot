use super::*;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

pub struct InputControl {
    sender: UnboundedSender<Value>,
    pub receiver: Mutex<Option<UnboundedReceiver<Value>>>,
}

static INPUTS: std::sync::LazyLock<Mutex<HashMap<String, Arc<InputControl>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

pub async fn register(request_id: &str) {
    let (sender, receiver) = unbounded_channel();
    INPUTS.lock().await.insert(request_id.to_string(), Arc::new(InputControl { sender, receiver: Mutex::new(Some(receiver)) }));
}

pub async fn get(request_id: &str) -> Option<Arc<InputControl>> {
    INPUTS.lock().await.get(request_id).cloned()
}

pub async fn remove(request_id: &str) { INPUTS.lock().await.remove(request_id); }

/// 对应 Codex turn/steer 的活动轮次前置条件。只向指定任务追加输入，不设置
/// abort，也不重新启动模型请求；宿主尚在准备时输入暂存在该轮次的通道中。
#[tauri::command]
pub async fn steer_agent(request_id: String, mut input: AgentRequest, state: State<'_, AppState>) -> Result<Value, AppError> {
    let runs = state.running.lock().await;
    let run = runs.get(&request_id).ok_or_else(|| AppError::Configuration("这一轮已经结束，请正常发送这条消息。".into()))?.clone();
    drop(runs);
    if input.client_thread_id.as_deref().is_some_and(|thread| thread != run.thread_id) {
        return Err(AppError::Configuration("当前会话已切换，请在原会话中调整方向。".into()));
    }
    let control = get(&request_id).await.ok_or_else(|| AppError::Configuration("当前任务没有可用的输入通道，请加入队列。".into()))?;
    prepare_attachments(&mut input.attachments);
    if input.message.trim().is_empty() && input.attachments.is_empty() && input.response_annotations.is_empty() {
        return Err(AppError::Configuration("请输入调整内容或添加附件。".into()));
    }
    let input_id = input.request_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    control.sender.send(json!({
        "type": "steer", "id": input_id, "message": input.message,
        "attachments": input.attachments, "references": input.references,
        "response_annotations": input.response_annotations, "skills": input.skills,
    })).map_err(|_| AppError::Configuration("这一轮刚刚结束，请正常发送这条消息。".into()))?;
    Ok(json!({ "accepted": true, "input_id": input_id, "request_id": request_id }))
}
