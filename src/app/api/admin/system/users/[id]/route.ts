import { assertCode, assertPassword, handleError, hashPassword, HttpError, publicUser, readJson, requireAdmin } from "@/lib/auth";
import { AdminUser } from "@/lib/models";

/** 修改、刪除使用者都需要後台驗證碼（ADMIN_CODE，或後台解鎖期間） */

type Ctx = RouteContext<"/api/admin/system/users/[id]">;

/** 自己不能把自己降級、停用或刪除，避免把唯一的管理者鎖在外面 */
function assertNotSelf(adminId: string, id: string, what: string) {
  if (adminId === id) throw new HttpError(400, `不能${what}自己的帳號`);
}

/** PATCH { name?, role?, active?, password? } */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    await assertCode(req, admin, "修改");
    const { id } = await ctx.params;
    const body = await readJson(req);
    const user = await AdminUser.findById(id);
    if (!user) throw new HttpError(404, "找不到這個使用者");

    const set: Record<string, unknown> = {};
    if (body.name !== undefined) set.name = String(body.name).trim();
    if (body.role !== undefined) {
      if (body.role !== "admin" && body.role !== "user") throw new HttpError(400, "身分只能是管理者或一般使用者");
      if (body.role !== "admin") assertNotSelf(admin.id, id, "降級");
      set.role = body.role;
    }
    if (body.active !== undefined) {
      if (!body.active) assertNotSelf(admin.id, id, "停用");
      set.active = !!body.active;
    }
    if (body.password !== undefined) {
      assertPassword(body.password);
      set.passwordHash = await hashPassword(body.password);
    }
    user.set(set);
    await user.save();
    return Response.json(publicUser(user.toObject() as unknown as Record<string, unknown>));
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    await assertCode(req, admin, "刪除");
    const { id } = await ctx.params;
    assertNotSelf(admin.id, id, "刪除");
    const res = await AdminUser.deleteOne({ _id: id });
    if (!res.deletedCount) throw new HttpError(404, "找不到這個使用者");
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
