/* Gemini 對話＋函式呼叫（REST v1beta） */

/** 失敗（逾時、503、429）的模型，這段時間內先跳過（還有別的模型可用時） */
const COOLDOWN = 5 * 60_000;
const downUntil = new Map<string, number>();
/** 一整輪對話（含呼叫函式）最多花的時間：LINE webhook 函式上限 60 秒，要留時間回覆客人 */
const CHAT_BUDGET = 45_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Part = Record<string, any>;
export interface Content {
  role: "user" | "model";
  parts: Part[];
}
export interface FunctionDecl {
  name: string;
  description: string;
  parameters?: object;
}
export type ToolHandler = (args: Record<string, unknown>) => Promise<object>;

export const geminiEnabled = () => !!process.env.GEMINI_API_KEY;

async function generate(system: string, contents: Content[], tools: FunctionDecl[], deadline: number, afterTools: boolean, all: string[], used: { model?: string }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("請設定 GEMINI_API_KEY");
  let lastError = "";
  const up = all.filter((m) => Date.now() >= (downUntil.get(m) ?? 0));
  const models = up.length ? up : all;
  for (const [i, model] of models.entries()) {
    const left = deadline - Date.now();
    if (left < 3_000) {
      lastError ||= "時間不夠";
      break;
    }
    // 後面還有模型可以換時最多等 15 秒
    const timeout = Math.min(left, i < models.length - 1 ? 15_000 : 25_000);
    const markDown = () => {
      if (models.length > 1) downUntil.set(model, Date.now() + COOLDOWN);
    };
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          ...(tools.length ? { tools: [{ functionDeclarations: tools }] } : {}),
          generationConfig: { temperature: 0.4 },
        }),
        signal: AbortSignal.timeout(timeout),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastError = `${model}: ${data?.error?.message ?? `HTTP ${res.status}`}`;
        if (res.status === 429 || res.status >= 500) markDown();
        continue;
      }
      used.model = model;
      const content = data?.candidates?.[0]?.content as Content | undefined;
      if (!content?.parts?.length) {
        // 已經呼叫過函式（例如只傳照片），模型正常結束、不再打字 → 沒有文字也算完成
        if (afterTools && data?.candidates?.[0]?.finishReason === "STOP") return { role: "model" as const, parts: [] };
        lastError = `${model}: empty response (${data?.candidates?.[0]?.finishReason ?? "?"})`;
        continue;
      }
      return { ...content, role: "model" as const };
    } catch (e) {
      // 逾時或連線失敗
      lastError = `${model}: ${e instanceof Error ? e.message : String(e)}`;
      markDown();
    }
  }
  throw new Error(`Gemini 失敗：${lastError}`);
}

/**
 * 跑一輪對話：模型要呼叫函式就執行後把結果交回，最多 5 回合；回傳最後的文字。
 * models：依序嘗試的 Gemini 模型；used.model 回傳實際回答的模型。
 */
export async function chat(
  system: string,
  contents: Content[],
  tools: FunctionDecl[],
  handlers: Record<string, ToolHandler>,
  opts: { models: string[]; budget?: number; used?: { model?: string } },
) {
  const used = opts.used ?? {};
  const convo = [...contents];
  const deadline = Date.now() + Math.min(opts.budget ?? CHAT_BUDGET, CHAT_BUDGET);
  for (let round = 0; round < 5; round++) {
    const out = await generate(system, convo, tools, deadline, round > 0, opts.models, used);
    if (!out.parts.length) return "";
    convo.push(out);
    const calls = out.parts.filter((p) => p.functionCall);
    if (!calls.length) {
      return out.parts
        .filter((p) => typeof p.text === "string" && !p.thought)
        .map((p) => p.text as string)
        .join("")
        .trim();
    }
    const responses: Part[] = [];
    for (const c of calls) {
      const { name, args, id } = c.functionCall as { name: string; args?: Record<string, unknown>; id?: string };
      let result: object;
      try {
        const h = handlers[name];
        result = h ? await h(args ?? {}) : { error: `沒有這個函式 ${name}` };
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) };
      }
      responses.push({ functionResponse: { name, ...(id ? { id } : {}), response: result } });
    }
    convo.push({ role: "user", parts: responses });
  }
  return "";
}

/** 換版本前測試這個模型能不能用 */
export async function geminiPing(model: string) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("沒有設定 GEMINI_API_KEY");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "回覆 OK" }] }] }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  }
}
