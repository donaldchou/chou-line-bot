import { createHmac } from "node:crypto";
import { safeEqual } from "./sign";

/* LINE Messaging API（不用 SDK，直接呼叫 REST） */

const API = "https://api.line.me/v2/bot";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LineMessage = Record<string, any>;
export interface QuickItem {
  label: string;
  text?: string;
  data?: string;
}

const token = () => {
  const t = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!t) throw new Error("請設定 LINE_CHANNEL_ACCESS_TOKEN");
  return t;
};

export function verifySignature(body: string, signature: string | null) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest("base64");
  return safeEqual(expected, signature);
}

async function post(path: string, body: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token()}`, ...extra },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`LINE ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export const reply = (replyToken: string, messages: LineMessage[]) => post("/message/reply", { replyToken, messages: messages.slice(0, 5) });

export const push = (to: string, messages: LineMessage[]) =>
  post("/message/push", { to, messages: messages.slice(0, 5) }, { "X-Line-Retry-Key": crypto.randomUUID() });

/** 先用 reply（免費）；reply token 過期或失敗時改用 push */
export async function send(userId: string, replyToken: string | undefined, messages: LineMessage[]) {
  for (let i = 0; i < messages.length; i += 5) {
    const chunk = messages.slice(i, i + 5);
    if (i === 0 && replyToken) {
      try {
        await reply(replyToken, chunk);
        continue;
      } catch (e) {
        console.error("reply failed, fallback to push", e);
      }
    }
    await push(userId, chunk);
  }
}

/** 對話框顯示「輸入中」動畫（最多 60 秒，回覆後自動消失） */
export async function showLoading(userId: string, seconds = 30) {
  try {
    await post("/chat/loading/start", { chatId: userId, loadingSeconds: seconds });
  } catch {
    /* 非必要 */
  }
}

export async function getProfile(userId: string): Promise<{ displayName: string; pictureUrl?: string } | null> {
  try {
    const res = await fetch(`${API}/profile/${userId}`, { headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/* ---------- 訊息 ---------- */

export const textMsg = (text: string): LineMessage => ({ type: "text", text: text.slice(0, 5000) });

export const imageMsg = (url: string, preview = url): LineMessage => ({ type: "image", originalContentUrl: url, previewImageUrl: preview });

export function withQuickReply(msg: LineMessage, items: QuickItem[]): LineMessage {
  if (!items.length) return msg;
  return {
    ...msg,
    quickReply: {
      items: items.slice(0, 13).map((q) => ({
        type: "action",
        action: q.data
          ? { type: "postback", label: q.label.slice(0, 20), data: q.data, displayText: q.text ?? q.label }
          : { type: "message", label: q.label.slice(0, 20), text: q.text ?? q.label },
      })),
    },
  };
}
