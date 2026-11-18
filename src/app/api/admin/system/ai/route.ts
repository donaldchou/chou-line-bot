import { AiChoiceError, aiStatus, saveChoice } from "@/lib/ai";
import { assertCode, handleError, readJson, requireAdmin } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";

export const maxDuration = 60;

/** GET 目前使用的 AI 版本（主版本、備援）與最近的回答次數 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    await connectDB();
    return Response.json(await aiStatus());
  } catch (err) {
    return handleError(err);
  }
}

/** PUT { primary, fallback } 更換版本（先測試能用才存），需要驗證碼；立即生效 */
export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin(req);
    await assertCode(req, admin, "更換 AI 版本");
    await connectDB();
    return Response.json(await saveChoice(await readJson(req), admin.email));
  } catch (err) {
    if (err instanceof AiChoiceError) return Response.json({ error: err.message }, { status: 400 });
    return handleError(err);
  }
}
