import { assertCode, handleError, HttpError, requireAdmin } from "@/lib/auth";
import { purgeTrash, QaError, restoreTrash } from "@/lib/qa";

type Ctx = { params: Promise<{ id: string }> };
const validId = (id: string) => /^[0-9a-f]{24}$/.test(id);

/** POST 還原（需要驗證碼） */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    await assertCode(req, admin, "還原");
    const { id } = await ctx.params;
    if (!validId(id)) throw new HttpError(400, "編號不對");
    return Response.json({ ok: true, ...(await restoreTrash(id, admin.email)) });
  } catch (err) {
    if (err instanceof QaError) return Response.json({ error: err.message }, { status: 400 });
    return handleError(err);
  }
}

/** DELETE 永久刪除（需要驗證碼） */
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    await assertCode(req, admin, "永久刪除");
    const { id } = await ctx.params;
    if (!validId(id)) throw new HttpError(400, "編號不對");
    await purgeTrash(id);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof QaError) return Response.json({ error: err.message }, { status: 400 });
    return handleError(err);
  }
}
