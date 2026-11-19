import { AiChoiceError, aiStatus, saveBalance, saveChoice } from "@/lib/ai";
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

/**
 * PUT { primary, fallback } 更換版本（先測試能用才存），需要驗證碼；立即生效
 * PUT { balance }           輸入目前 Claude 儲值餘額（美元），從現在開始重新算花費
 */
export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin(req);
    const body = await readJson(req);
    await assertCode(req, admin, "balance" in body ? "儲存餘額" : "更換 AI 版本");
    await connectDB();
    if ("balance" in body) return Response.json(await saveBalance(body.balance));
    return Response.json(await saveChoice(body, admin.email));
  } catch (err) {
    if (err instanceof AiChoiceError) return Response.json({ error: err.message }, { status: 400 });
    return handleError(err);
  }
}
