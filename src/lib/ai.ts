import { chat as geminiChat, GEMINI_MODELS, geminiEnabled, type Content, type FunctionDecl, type ToolHandler } from "./gemini";
import { CLAUDE_MODEL, claudeChat, claudeEnabled, ClaudeMidTurnError } from "./claude";
import { AdminSetting } from "./models";

/* AI 對話入口：有 ANTHROPIC_API_KEY 就用 Claude，失敗時改用 Gemini */

const USAGE_ID = "aiUsage";
/** 回答次數只留最近幾天 */
const KEEP_DAYS = 30;

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }); // YYYY-MM-DD
/** Mongo 欄位名稱不能有「.」 */
const field = (model: string) => model.replace(/\./g, "_");

/** 記下這次是哪個模型回答的（後台「AI 版本」顯示）；記錄失敗不影響回覆客人 */
async function recordUse(model: string, fellBack: boolean) {
  try {
    const d = today();
    await AdminSetting.collection.updateOne(
      { _id: USAGE_ID as never },
      {
        $inc: { [`days.${d}.${field(model)}`]: 1, ...(fellBack ? { [`days.${d}.__fallback`]: 1 } : {}) },
        $set: { last: { model, at: new Date(), fellBack } },
      },
      { upsert: true },
    );
  } catch (e) {
    console.error("recordUse", e);
  }
}

export async function chat(system: string, contents: Content[], tools: FunctionDecl[], handlers: Record<string, ToolHandler>) {
  const used: { model?: string } = {};
  if (!claudeEnabled()) {
    const text = await geminiChat(system, contents, tools, handlers, undefined, used);
    await recordUse(used.model ?? GEMINI_MODELS[0], false);
    return text;
  }
  const start = Date.now();
  try {
    const text = await claudeChat(system, contents, tools, handlers);
    await recordUse(CLAUDE_MODEL, false);
    return text;
  } catch (e) {
    // 已經執行過函式（可能傳了卡片、照片）就不能重來一次
    if (e instanceof ClaudeMidTurnError) throw e;
    console.error("Claude 失敗，改用 Gemini", e);
    // LINE webhook 上限 60 秒：扣掉 Claude 已經用掉的時間
    const text = await geminiChat(system, contents, tools, handlers, Math.max(12_000, 48_000 - (Date.now() - start)), used);
    await recordUse(used.model ?? GEMINI_MODELS[0], true);
    return text;
  }
}

/* ---------------- 後台「AI 版本」 ---------------- */

/** claude-haiku-5-5 → Claude Haiku 5.5；gemini-3.5-flash-lite → Gemini 3.5 Flash Lite */
export function modelLabel(id: string) {
  const out: string[] = [];
  for (const p of id.split("-")) {
    const prev = out[out.length - 1];
    if (/^\d+(\.\d+)?$/.test(p) && prev && /^\d/.test(prev) && !prev.includes(".")) out[out.length - 1] = `${prev}.${p}`;
    else out.push(/^\d/.test(p) ? p : p[0].toUpperCase() + p.slice(1));
  }
  return out.join(" ");
}

export type AiModelInfo = { id: string; label: string; provider: string; role: string; keySet: boolean; keyEnv: string; modelEnv: string };
export type AiStatus = {
  models: AiModelInfo[];
  last: { model: string; label: string; at: string; fellBack: boolean } | null;
  days: { date: string; counts: { model: string; label: string; n: number }[]; fallback: number }[];
};

export async function aiStatus(): Promise<AiStatus> {
  const claude: AiModelInfo = {
    id: CLAUDE_MODEL,
    label: modelLabel(CLAUDE_MODEL),
    provider: "Anthropic",
    role: "",
    keySet: claudeEnabled(),
    keyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "CLAUDE_MODEL",
  };
  const gem = GEMINI_MODELS.map(
    (id, i): AiModelInfo => ({
      id,
      label: modelLabel(id),
      provider: "Google",
      role: "",
      keySet: geminiEnabled(),
      keyEnv: "GEMINI_API_KEY",
      modelEnv: i === 0 ? "GEMINI_MODEL" : "",
    }),
  );
  const models = (claude.keySet ? [claude, ...gem] : gem).map((m, i) => ({ ...m, role: i === 0 ? "主版本" : `備援 ${i}` }));

  const doc = (await AdminSetting.findById(USAGE_ID).lean()) as {
    last?: { model: string; at: Date; fellBack: boolean };
    days?: Record<string, Record<string, number>>;
  } | null;
  const known = new Map([claude, ...gem].map((m) => [field(m.id), m.id]));
  const days = Object.entries(doc?.days ?? {})
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, KEEP_DAYS)
    .map(([date, c]) => ({
      date,
      fallback: c.__fallback ?? 0,
      counts: Object.entries(c)
        .filter(([k]) => k !== "__fallback")
        .map(([k, n]) => {
          const id = known.get(k) ?? k.replace(/_/g, ".");
          return { model: id, label: modelLabel(id), n };
        })
        .sort((a, b) => b.n - a.n),
    }));
  return {
    models,
    last: doc?.last ? { model: doc.last.model, label: modelLabel(doc.last.model), at: new Date(doc.last.at).toISOString(), fellBack: doc.last.fellBack } : null,
    days,
  };
}
