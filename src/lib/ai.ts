import { chat as geminiChat, type Content, type FunctionDecl, type ToolHandler } from "./gemini";
import { claudeChat, claudeEnabled, ClaudeMidTurnError } from "./claude";

/* AI 對話入口：有 ANTHROPIC_API_KEY 就用 Claude，失敗時改用 Gemini */

export async function chat(system: string, contents: Content[], tools: FunctionDecl[], handlers: Record<string, ToolHandler>) {
  if (!claudeEnabled()) return geminiChat(system, contents, tools, handlers);
  const start = Date.now();
  try {
    return await claudeChat(system, contents, tools, handlers);
  } catch (e) {
    // 已經執行過函式（可能傳了卡片、照片）就不能重來一次
    if (e instanceof ClaudeMidTurnError) throw e;
    console.error("Claude 失敗，改用 Gemini", e);
    // LINE webhook 上限 60 秒：扣掉 Claude 已經用掉的時間
    return geminiChat(system, contents, tools, handlers, Math.max(12_000, 48_000 - (Date.now() - start)));
  }
}
