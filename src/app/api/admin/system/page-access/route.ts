import { assertCode, getPageAccess, handleError, readJson, requireAdmin, savePageAccess } from "@/lib/auth";

/** GET 頁面權限設定 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    return Response.json(await getPageAccess());
  } catch (err) {
    return handleError(err);
  }
}

/** PUT { allowed, hidden } 儲存，需要驗證碼 */
export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin(req);
    await assertCode(req, admin, "修改");
    return Response.json(await savePageAccess(await readJson(req)));
  } catch (err) {
    return handleError(err);
  }
}
