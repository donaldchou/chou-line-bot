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

/** 群發：一次最多 500 人；每位收到的人算 1 則訊息（同一次最多 5 個訊息物件） */
export const multicast = (to: string[], messages: LineMessage[], retryKey: string) =>
  post("/message/multicast", { to: to.slice(0, 500), messages: messages.slice(0, 5) }, { "X-Line-Retry-Key": retryKey });

/** 本月訊息額度：limit＝方案上限（null＝不限）、used＝本月已用 */
export async function quota(): Promise<{ limit: number | null; used: number } | null> {
  try {
    const h = { authorization: `Bearer ${token()}` };
    const [q, c] = await Promise.all(
      ["/message/quota", "/message/quota/consumption"].map((p) =>
        fetch(`${API}${p}`, { headers: h, signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : null)),
      ),
    );
    if (!q || !c) return null;
    return { limit: q.type === "limited" ? Number(q.value) : null, used: Number(c.totalUsage) || 0 };
  } catch {
    return null;
  }
}

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

/* ---------- 圖文選單（rich menu） ---------- */

const DATA_API = "https://api-data.line.me/v2/bot";

export type RichMenuAction = { type: "message"; label?: string; text: string } | { type: "uri"; label?: string; uri: string };
export interface RichMenuBody {
  size: { width: number; height: number };
  selected: boolean;
  name: string;
  chatBarText: string;
  areas: { bounds: { x: number; y: number; width: number; height: number }; action: RichMenuAction }[];
}

async function rm(path: string, init: RequestInit = {}, base = API) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token()}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  return res;
}

async function rmOk(path: string, init: RequestInit = {}, base = API) {
  const res = await rm(path, init, base);
  if (!res.ok) throw new Error(`LINE 圖文選單 ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

/** 建立選單（先檢查格式），回傳 richMenuId */
export async function createRichMenu(body: RichMenuBody) {
  const json = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  await rmOk("/richmenu/validate", json);
  const d = (await (await rmOk("/richmenu", json)).json()) as { richMenuId: string };
  return d.richMenuId;
}

export async function uploadRichMenuImage(id: string, bytes: Uint8Array, type: "image/png" | "image/jpeg") {
  await rmOk(`/richmenu/${id}/content`, { method: "POST", headers: { "content-type": type }, body: bytes as BodyInit }, DATA_API);
}

export async function downloadRichMenuImage(id: string) {
  const res = await rmOk(`/richmenu/${id}/content`, {}, DATA_API);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "" };
}

export async function getRichMenu(id: string) {
  return (await (await rmOk(`/richmenu/${id}`)).json()) as RichMenuBody & { richMenuId: string };
}

/** 刪除選單；已經不在了也算成功 */
export async function deleteRichMenu(id: string) {
  const res = await rm(`/richmenu/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`LINE 刪除圖文選單 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** 所有客人的預設選單（用程式設定的）；沒有、或是 LINE 官方帳號後台設定的 → null */
export async function getDefaultRichMenuId() {
  const res = await rm("/user/all/richmenu");
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`LINE 讀取預設圖文選單 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()) as { richMenuId: string }).richMenuId;
}

export const setDefaultRichMenu = (id: string) => rmOk(`/user/all/richmenu/${id}`, { method: "POST" }).then(() => {});

/** 拿掉程式設定的預設選單（客人會改看到 LINE 官方帳號後台設定的選單） */
export async function clearDefaultRichMenu() {
  const res = await rm("/user/all/richmenu", { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`LINE 停用預設圖文選單 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** 只給一個人看的選單（優先於預設選單） */
export const linkUserRichMenu = (userId: string, id: string) => rmOk(`/user/${userId}/richmenu/${id}`, { method: "POST" }).then(() => {});

export async function unlinkUserRichMenu(userId: string) {
  const res = await rm(`/user/${userId}/richmenu`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`LINE 取消個人圖文選單 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
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
