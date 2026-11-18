import Anthropic from "@anthropic-ai/sdk";
import type { Content, FunctionDecl, ToolHandler } from "./gemini";

/* Claude 對話＋函式呼叫（用哪個模型由 ai.ts 決定） */

/** 一整輪對話（含呼叫函式）最多花的時間：LINE webhook 函式上限 60 秒，要留時間回覆客人 */
const CHAT_BUDGET = 45_000;
const MAX_ROUNDS = 6;

let client: Anthropic | null = null;
// 不自動重試：失敗就交給備援，免得客人等太久
const getClient = () => (client ??= new Anthropic({ maxRetries: 0 }));

export const claudeEnabled = () => !!process.env.ANTHROPIC_API_KEY;

/** 對話紀錄轉成 Claude 格式（同一方連續的訊息合併，第一則一定是客人） */
function toMessages(contents: Content[]): Anthropic.MessageParam[] {
  const out: { role: "user" | "assistant"; text: string }[] = [];
  for (const c of contents) {
    const text = c.parts
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("")
      .trim();
    if (!text) continue;
    const role = c.role === "model" ? "assistant" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role) last.text += `\n${text}`;
    else out.push({ role, text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out.map((m) => ({ role: m.role, content: m.text }));
}

/**
 * 跑一輪對話：模型要呼叫函式就執行後把結果交回；回傳最後的文字。
 * firstTimeout：第一次呼叫最多等多久（後面還有備援時要短一點）
 */
export async function claudeChat(
  system: string,
  contents: Content[],
  tools: FunctionDecl[],
  handlers: Record<string, ToolHandler>,
  opts: { model: string; budget?: number; firstTimeout?: number },
) {
  const messages = toMessages(contents);
  if (!messages.length) return "";
  const deadline = Date.now() + Math.min(opts.budget ?? CHAT_BUDGET, CHAT_BUDGET);
  const toolDefs: Anthropic.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: (t.parameters ?? { type: "object", properties: {} }) as Anthropic.Tool.InputSchema,
  }));
  let ranTools = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const left = deadline - Date.now();
    if (left < 3_000) break;
    const res = await getClient().messages.create(
      {
        model: opts.model,
        max_tokens: 4000,
        system,
        ...(toolDefs.length ? { tools: toolDefs } : {}),
        messages,
        output_config: { effort: "low" },
        cache_control: { type: "ephemeral" },
      },
      { timeout: Math.min(left, ranTools ? 30_000 : (opts.firstTimeout ?? 30_000)) },
    );
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) return text;
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const c of calls) {
      let result: object;
      try {
        const h = handlers[c.name];
        result = h ? await h((c.input ?? {}) as Record<string, unknown>) : { error: `沒有這個函式 ${c.name}` };
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) };
      }
      results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(result) });
    }
    ranTools = true;
    messages.push({ role: "user", content: results });
  }
  if (ranTools) return "";
  throw new Error("Claude 失敗：時間不夠");
}

/** 換版本前測試這個模型能不能用 */
export async function claudePing(model: string) {
  if (!claudeEnabled()) throw new Error("沒有設定 ANTHROPIC_API_KEY");
  await getClient().messages.create({ model, max_tokens: 200, messages: [{ role: "user", content: "回覆 OK" }] }, { timeout: 25_000 });
}
