/* Gemini 對話＋函式呼叫（REST v1beta） */

// 3.6-flash 偶爾 503 high demand，失敗時改用 3.5-flash-lite
const MODELS = [process.env.GEMINI_MODEL || "gemini-3.6-flash", "gemini-3.5-flash-lite"];

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

async function generate(system: string, contents: Content[], tools: FunctionDecl[]) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("請設定 GEMINI_API_KEY");
  let lastError = "";
  for (const model of MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          tools: [{ functionDeclarations: tools }],
          generationConfig: { temperature: 0.4 },
        }),
        signal: AbortSignal.timeout(25_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastError = data?.error?.message ?? `HTTP ${res.status}`;
        continue;
      }
      const content = data?.candidates?.[0]?.content as Content | undefined;
      if (!content?.parts?.length) {
        lastError = `empty response (${data?.candidates?.[0]?.finishReason ?? "?"})`;
        continue;
      }
      return { ...content, role: "model" as const };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`Gemini 失敗：${lastError}`);
}

/** 跑一輪對話：模型要呼叫函式就執行後把結果交回，最多 5 回合；回傳最後的文字 */
export async function chat(system: string, contents: Content[], tools: FunctionDecl[], handlers: Record<string, ToolHandler>) {
  const convo = [...contents];
  for (let round = 0; round < 5; round++) {
    const out = await generate(system, convo, tools);
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
