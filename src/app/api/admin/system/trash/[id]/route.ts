import { assertCode, handleError, HttpError, requireAdmin } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { Trash } from "@/lib/models";
import { purgeTrash, QaError, restoreTrash } from "@/lib/qa";
import { purgeMenuTrash, restoreMenuTrash } from "@/lib/richmenu";

type Ctx = { params: Promise<{ id: string }> };
const validId = (id: string) => /^[0-9a-f]{24}$/.test(id);

/** 這筆是問答還是圖文選單 */
async function kindOf(id: string) {
  await connectDB();
  const t = await Trash.findById(id, { kind: 1 }).lean<{ kind: string }>();
  if (!t) throw new HttpError(404, "找不到這筆已刪除紀錄（可能已經還原或永久刪除）");
  return t.kind;
}

/** POST 還原（需要驗證碼） */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    await assertCode(req, admin, "還原");
    const { id } = await ctx.params;
    if (!validId(id)) throw new HttpError(400, "編號不對");
    const r = (await kindOf(id)) === "richmenu" ? await restoreMenuTrash(id) : await restoreTrash(id, admin.email);
    return Response.json({ ok: true, ...r });
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
    if ((await kindOf(id)) === "richmenu") await purgeMenuTrash(id);
    else await purgeTrash(id);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof QaError) return Response.json({ error: err.message }, { status: 400 });
    return handleError(err);
  }
}
