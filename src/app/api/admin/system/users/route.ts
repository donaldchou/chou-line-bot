import {
  assertCode,
  assertEmail,
  assertPassword,
  handleError,
  hashPassword,
  HttpError,
  normEmail,
  publicUser,
  readJson,
  requireAdmin,
} from "@/lib/auth";
import { AdminUser } from "@/lib/models";

/** GET /api/admin/system/users 所有使用者（管理者在前） */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const docs = await AdminUser.find().sort({ role: 1, createdAt: 1 }).lean();
    return Response.json(docs.map((d) => publicUser(d as unknown as Record<string, unknown>)));
  } catch (err) {
    return handleError(err);
  }
}

/** POST { email, password, name?, role? } 新增使用者（預設一般使用者），需要驗證碼 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    await assertCode(req, admin, "新增");
    const body = await readJson(req);
    const email = normEmail(body.email);
    assertEmail(email);
    assertPassword(body.password);
    const role = body.role ?? "user";
    if (role !== "admin" && role !== "user") throw new HttpError(400, "身分只能是管理者或一般使用者");
    if (await AdminUser.exists({ email })) throw new HttpError(409, `${email} 已經有帳號了`);
    const doc = await AdminUser.create({
      _id: crypto.randomUUID(),
      email,
      name: String(body.name ?? "").trim(),
      role,
      passwordHash: await hashPassword(body.password),
    });
    return Response.json(publicUser(doc.toObject() as unknown as Record<string, unknown>), { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
