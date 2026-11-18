import { chat as geminiChat, geminiEnabled, geminiPing, type Content, type FunctionDecl, type ToolHandler } from "./gemini";
import { claudeChat, claudeEnabled, claudePing } from "./claude";
import { AdminSetting } from "./models";
import { AI_MODELS, aiErrorText, isAiModel, KEY_LABEL, LAST_RESORT, modelLabel, PROVIDER_LABEL, providerOf, type AiChoice, type AiStatus, type Provider } from "./ai-models";

/*
 * AI 對話入口：依後台「AI版本」設定的主版本 → 備援 → 最後再試 Gemini Flash Lite。
 * 設定存在 adminSettings「aiModels」，每次回答都重新讀，改了立即生效。
 */

const CHOICE_ID = "aiModels";
const USAGE_ID = "aiUsage";
/** 整輪最多花的時間（LINE webhook 上限 60 秒，要留時間回覆客人） */
const TOTAL_BUDGET = 48_000;
const KEEP_DAYS = 30;

const keySet = (p: Provider) => (p === "anthropic" ? claudeEnabled() : geminiEnabled());

/** 還沒在後台設定過時的預設值 */
function defaultChoice(): AiChoice {
  const claude = process.env.CLAUDE_MODEL || "claude-haiku-5-5";
  const gemini = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  return claudeEnabled() ? { primary: claude, fallback: gemini } : { primary: gemini, fallback: LAST_RESORT };
}

type ChoiceDoc = { primary?: string; fallback?: string; at?: Date; by?: string };
async function choiceDoc() {
  return (await AdminSetting.findById(CHOICE_ID).lean()) as ChoiceDoc | null;
}
export async function getChoice(): Promise<AiChoice> {
  const d = await choiceDoc().catch(() => null);
  const def = defaultChoice();
  return { primary: d?.primary || def.primary, fallback: d?.fallback || def.fallback };
}

/** 實際嘗試的順序（沒設定金鑰的跳過） */
function chainOf(c: AiChoice) {
  return [...new Set([c.primary, c.fallback, LAST_RESORT])].filter((m) => keySet(providerOf(m)));
}

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }); // YYYY-MM-DD
/** Mongo 欄位名稱不能有「.」 */
const field = (model: string) => model.replace(/\./g, "_");

/** 記下這次是哪個模型回答的（後台「AI版本」顯示）；記錄失敗不影響回覆客人 */
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
  const chain = chainOf(await getChoice());
  if (!chain.length) throw new Error("沒有可用的 AI（主機上 Claude 金鑰、Gemini 金鑰都沒設定）");
  // 連續的 Gemini 模型一起交給 gemini.ts（它會自己換模型，函式呼叫到一半也能換）
  const steps: { provider: Provider; models: string[] }[] = [];
  for (const m of chain) {
    const p = providerOf(m);
    const last = steps[steps.length - 1];
    if (p === "google" && last?.provider === "google") last.models.push(m);
    else steps.push({ provider: p, models: [m] });
  }
  // 已經執行過函式（可能傳了卡片、照片）就不能換模型整輪重來
  let ranTools = false;
  const wrapped = Object.fromEntries(
    Object.entries(handlers).map(([k, h]) => [
      k,
      (a: Record<string, unknown>) => {
        ranTools = true;
        return h(a);
      },
    ]),
  );
  const start = Date.now();
  const errs: string[] = [];
  for (const [i, s] of steps.entries()) {
    const budget = TOTAL_BUDGET - (Date.now() - start);
    if (budget < 8_000) break;
    const more = i < steps.length - 1;
    try {
      if (s.provider === "anthropic") {
        const text = await claudeChat(system, contents, tools, wrapped, { model: s.models[0], budget, firstTimeout: more ? 20_000 : undefined });
        await recordUse(s.models[0], s.models[0] !== chain[0]);
        return text;
      }
      const used: { model?: string } = {};
      const text = await geminiChat(system, contents, tools, wrapped, { models: s.models, budget, used });
      const m = used.model ?? s.models[0];
      await recordUse(m, m !== chain[0]);
      return text;
    } catch (e) {
      console.error(`AI 失敗（${s.models.join("、")}）`, e);
      errs.push(aiErrorText(e, s.models.length === 1 ? s.models[0] : undefined));
      if (ranTools) break;
    }
  }
  // 給農場主人看的通知：中文說明
  throw new Error(`AI 沒有回覆（${errs.join("；") || "時間不夠"}）`);
}

/* ---------------- 後台「AI版本」 ---------------- */

export async function aiStatus(): Promise<AiStatus> {
  const [d, usage] = await Promise.all([
    choiceDoc(),
    AdminSetting.findById(USAGE_ID).lean() as Promise<{ last?: { model: string; at: Date; fellBack: boolean }; days?: Record<string, Record<string, number>> } | null>,
  ]);
  const choice = await getChoice();
  const chain = [...new Set([choice.primary, choice.fallback, LAST_RESORT])].map((id, i) => {
    const p = providerOf(id);
    return { id, label: modelLabel(id), provider: PROVIDER_LABEL[p], role: i === 0 ? "主版本" : `備援 ${i}`, keySet: keySet(p), keyEnv: KEY_LABEL[p] };
  });
  const known = new Map(AI_MODELS.map((m) => [field(m.id), m.id as string]));
  const days = Object.entries(usage?.days ?? {})
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
    choice,
    chain,
    keys: { anthropic: claudeEnabled(), google: geminiEnabled() },
    updated: d?.at ? { at: new Date(d.at).toISOString(), by: d.by ?? "" } : null,
    last: usage?.last ? { model: usage.last.model, label: modelLabel(usage.last.model), at: new Date(usage.last.at).toISOString(), fellBack: usage.last.fellBack } : null,
    days,
  };
}

export class AiChoiceError extends Error {}

/** 儲存主版本、備援；先實際測試兩個模型都能回答才存 */
export async function saveChoice(body: Record<string, unknown>, by: string) {
  const primary = body.primary;
  const fallback = body.fallback;
  if (!isAiModel(primary) || !isAiModel(fallback)) throw new AiChoiceError("請從清單選擇版本");
  if (primary === fallback) throw new AiChoiceError("主版本和備援要選不同的版本");
  for (const m of [primary, fallback]) {
    const p = providerOf(m);
    if (!keySet(p)) throw new AiChoiceError(`${modelLabel(m)} 需要${KEY_LABEL[p]}，主機還沒設定`);
  }
  await Promise.all(
    [primary, fallback].map(async (m) => {
      try {
        await (providerOf(m) === "anthropic" ? claudePing(m) : geminiPing(m));
      } catch (e) {
        throw new AiChoiceError(`測試失敗，沒有儲存。${aiErrorText(e, m)}`);
      }
    }),
  );
  await AdminSetting.updateOne({ _id: CHOICE_ID }, { $set: { primary, fallback, at: new Date(), by } }, { upsert: true });
  return aiStatus();
}
