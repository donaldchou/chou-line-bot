import Anthropic from "@anthropic-ai/sdk";
import type { Content, FunctionDecl, ToolHandler } from "./gemini";

/* Claude 對話＋函式呼叫（主力模型；失敗時 ai.ts 會改用 Gemini） */

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";
/** 一整輪對話（含呼叫函式）最多花的時間：LINE webhook 函式上限 60 秒，要留時間回覆客人 */
const CHAT_BUDGET = 45_000;
const MAX_ROUNDS = 6;

let client: Anthropic | null = null;
// 不自動重試：失敗就交給 Gemini，免得客人等太久
const getClient = () => (client ??= new Anthropic({ maxRetries: 0 }));

export const claudeEnabled = () => !!process.env.ANTHROPIC_API_KEY;

/** Claude 已經執行過函式之後才失敗：不能整輪重來（會重複傳卡片），呼叫端要直接當失敗處理 */
export class ClaudeMidTurnError extends Error {}

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

/** 跑一輪對話：模型要呼叫函式就執行後把結果交回；回傳最後的文字 */
export async function claudeChat(system: string, contents: Content[], tools: FunctionDecl[], handlers: Record<string, ToolHandler>) {
  const messages = toMessages(contents);
  if (!messages.length) return "";
  const deadline = Date.now() + CHAT_BUDGET;
  const toolDefs: Anthropic.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: (t.parameters ?? { type: "object", properties: {} }) as Anthropic.Tool.InputSchema,
  }));
  let ranTools = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const left = deadline - Date.now();
    if (left < 3_000) break;
    let res: Anthropic.Message;
    try {
      res = await getClient().messages.create(
        {
          model: MODEL,
          max_tokens: 4000,
          system,
          tools: toolDefs,
          messages,
          output_config: { effort: "low" },
          cache_control: { type: "ephemeral" },
        },
        // 第一次最多等 20 秒（之後還要留時間給 Gemini）；函式呼叫後的回合等到整輪時間用完
        { timeout: Math.min(left, ranTools ? 30_000 : 20_000) },
      );
    } catch (e) {
      if (ranTools) throw new ClaudeMidTurnError(`Claude 失敗：${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
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
