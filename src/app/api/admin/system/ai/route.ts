import { aiStatus } from "@/lib/ai";
import { handleError, requireAdmin } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";

/** GET 目前使用的 AI 模型（主版本、備援）與最近的回答次數 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    await connectDB();
    return Response.json(await aiStatus());
  } catch (err) {
    return handleError(err);
  }
}
