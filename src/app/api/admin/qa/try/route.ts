import { handleError, HttpError, readJson, requireAdmin } from "@/lib/auth";
import { parseDraft, QaError, qaPromptText } from "@/lib/qa";
import { previewAnswer } from "@/lib/qa-answer";

export const maxDuration = 60;

/**
 * 先試問機器人：用還沒存檔的問答回答一個問題，不會傳給客人。
 * POST { id?, cat, q, alt, a, notify, question, followup? }
 * followup＝從「答不出來的問題」來的，預覽主動回覆客人的口氣
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = await readJson(req);
    const question = String(body.question ?? "").trim().slice(0, 500);
    if (!question) throw new HttpError(400, "請輸入要試問的問題");
    const id = typeof body.id === "string" && /^[\w-]{1,40}$/.test(body.id) ? body.id : undefined;
    const draft = await parseDraft(body);
    const faq = await qaPromptText({ id, draft });
    return Response.json(await previewAnswer(question, faq, { followup: body.followup === true }));
  } catch (err) {
    if (err instanceof QaError) return Response.json({ error: err.message }, { status: 400 });
    return handleError(err);
  }
}
