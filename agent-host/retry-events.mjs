import { randomUUID } from "node:crypto";

// 每次断线独立编号，同一次尝试的状态变化只更新原来的时间线记录。
export function createRetryEvents(send) {
  let sequence = "";
  let active = null;
  return ({ attempt, maxAttempts, delayMs = 0, statusCode = null, status = "running", title, detail }) => {
    if (!sequence || (status === "running" && attempt === 1)) sequence = randomUUID();
    const id = `retry-${sequence}-${attempt}`;
    if (status === "running" && active && active.id !== id) {
      send({ ...active, status: "done", title: `已重试 ${active.retry_attempt}/${active.retry_max_attempts}` });
    }
    const event = {
      id, kind: "retry", title, detail, status, tool: null,
      retry_attempt: attempt, retry_max_attempts: maxAttempts,
      retry_delay_ms: delayMs, retry_status: statusCode,
    };
    send(event);
    active = status === "running" ? event : null;
    if (status !== "running") sequence = "";
  };
}
