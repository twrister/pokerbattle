export interface FeedbackPayload {
  content: string;
  playerId: string;
  displayName: string;
  appVersion: string;
}

export type SubmitFeedbackResult = { ok: true } | { ok: false; error: string };

/**
 * 同源 /feedback：开发服/正式预览由 Vite 代理，生产环境由权威服直接托管。
 */
function buildFeedbackUrl(): string {
  const base = String(import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return `${base}/feedback`;
}

/** 把意见 POST 到权威服，HTTP 状态归一成中文提示。 */
export async function submitFeedback(payload: FeedbackPayload): Promise<SubmitFeedbackResult> {
  try {
    const response = await fetch(buildFeedbackUrl(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (response.status === 429) {
      return { ok: false, error: '提交过于频繁，请稍后再试' };
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: unknown };
      const message = typeof data.message === 'string' && data.message.trim()
        ? data.message
        : '提交失败，请稍后重试';
      return { ok: false, error: message };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: '无法连接服务器，请稍后重试' };
  }
}
