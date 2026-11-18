import { handleError, requireAdmin } from "@/lib/auth";
import { trashList } from "@/lib/qa";

/** GET 已刪除紀錄（目前只有問答管理） */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    return Response.json(await trashList());
  } catch (err) {
    return handleError(err);
  }
}
