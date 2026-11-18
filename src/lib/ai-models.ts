/* 後台「AI版本」可以選的模型（前後端共用，不能 import 伺服器的東西） */

export type Provider = "anthropic" | "google";

export const AI_MODELS = [
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "anthropic", note: "快、便宜（建議）" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "anthropic", note: "較聰明，費用約 Haiku 的 20 倍" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "anthropic", note: "最聰明，費用約 Haiku 的 40 倍、較慢" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", provider: "google", note: "最近常常很慢（15 秒以上）" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", provider: "google", note: "快、便宜，回答較簡單" },
] as const satisfies readonly { id: string; label: string; provider: Provider; note: string }[];

export type AiModelId = (typeof AI_MODELS)[number]["id"];
/** 主版本、備援都失敗時最後再試的模型 */
export const LAST_RESORT: AiModelId = "gemini-3.5-flash-lite";

export const isAiModel = (v: unknown): v is AiModelId => AI_MODELS.some((m) => m.id === v);
export const providerOf = (id: string): Provider => (id.startsWith("claude-") ? "anthropic" : "google");
export const PROVIDER_LABEL: Record<Provider, string> = { anthropic: "Anthropic 公司", google: "Google 公司" };
/** 主機上金鑰的環境變數名稱（只給程式用，畫面上顯示 KEY_LABEL） */
export const KEY_ENV: Record<Provider, string> = { anthropic: "ANTHROPIC_API_KEY", google: "GEMINI_API_KEY" };
export const KEY_LABEL: Record<Provider, string> = { anthropic: "Claude 金鑰", google: "Gemini 金鑰" };

/** AI 廠商回的英文錯誤 → 中文說明（後台與通知都用這個，不顯示英文原文） */
export function aiErrorText(e: unknown, model?: string) {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : Number(raw.match(/\b(4\d\d|5\d\d)\b/)?.[1] ?? 0);
  const who = model ? `${modelLabel(model)}：` : "";
  const is = (re: RegExp) => re.test(raw);
  let msg: string;
  if (/[一-鿿]/.test(raw) && !is(/[A-Za-z]{12,}/)) msg = raw;
  else if (is(/credit balance|billing|purchase credits/i)) msg = "Claude 帳戶餘額不足，請到 platform.claude.com 的 Billing 儲值";
  else if (is(/quota|RESOURCE_EXHAUSTED|free.?tier/i)) msg = "今天的免費額度已經用完（Google 免費方案每天有次數限制），明天會自動恢復";
  else if (status === 429 || is(/rate.?limit|too many requests/i)) msg = "短時間內用太多次，被暫時限制，請稍後再試";
  else if (status === 401 || status === 403 || is(/api.?key|authentication|permission|unauthorized/i)) msg = "金鑰錯誤或沒有權限，請檢查主機上的金鑰";
  else if (status === 404 || is(/not.?found|does not exist|unknown model/i)) msg = "找不到這個版本（可能已停用或名稱錯誤）";
  else if (status === 529 || status === 503 || is(/overloaded|high demand|unavailable/i)) msg = "廠商主機忙碌中，請稍後再試";
  else if (status >= 500) msg = "廠商主機出錯，請稍後再試";
  else if (is(/timed? ?out|timeout|aborted|時間不夠/i)) msg = "等太久沒有回應";
  else if (is(/fetch failed|network|ECONN|ENOTFOUND|socket/i)) msg = "連不上廠商主機（網路問題）";
  else if (is(/empty response/i)) msg = "沒有產生回覆";
  else msg = "發生錯誤";
  return `${who}${msg}${status && msg !== raw ? `（錯誤代碼 ${status}）` : ""}`;
}

/** claude-haiku-5-5 → Claude Haiku 5.5；不在清單的也盡量排好看 */
export function modelLabel(id: string) {
  const hit = AI_MODELS.find((m) => m.id === id);
  if (hit) return hit.label;
  const out: string[] = [];
  for (const p of id.split("-")) {
    const prev = out[out.length - 1];
    if (/^\d+(\.\d+)?$/.test(p) && prev && /^\d/.test(prev) && !prev.includes(".")) out[out.length - 1] = `${prev}.${p}`;
    else out.push(/^\d/.test(p) ? p : p[0].toUpperCase() + p.slice(1));
  }
  return out.join(" ");
}

export type AiChoice = { primary: string; fallback: string };

export type AiStatus = {
  choice: AiChoice;
  /** 實際的順序：主版本、備援 1、（最後再試的）備援 2 */
  chain: { id: string; label: string; provider: string; role: string; keySet: boolean; keyEnv: string }[];
  keys: Record<Provider, boolean>;
  updated: { at: string; by: string } | null;
  last: { model: string; label: string; at: string; fellBack: boolean } | null;
  days: { date: string; counts: { model: string; label: string; n: number }[]; fallback: number }[];
};
