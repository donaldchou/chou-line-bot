import { handleError, requireAdmin } from "@/lib/auth";
import { trashList } from "@/lib/qa";
import { menuTrashList } from "@/lib/richmenu";

/** GET 已刪除紀錄（問答管理、圖文選單），新的在前 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const [qa, menus] = await Promise.all([trashList(), menuTrashList()]);
    return Response.json([...qa, ...menus].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)));
  } catch (err) {
    return handleError(err);
  }
}
