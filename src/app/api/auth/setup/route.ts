import { NextResponse } from "next/server";
import {
  assertEmail,
  assertPassword,
  handleError,
  hashPassword,
  HttpError,
  normEmail,
  publicUser,
  readJson,
} from "@/lib/auth";
import { AdminUser } from "@/lib/models";
import { connectDB } from "@/lib/mongodb";
import { sessionCookie, signSession } from "@/lib/session";
import { safeEqual } from "@/lib/sign";

/**
 * 第一次使用：還沒有任何帳號時，輸入環境變數 ADMIN_PASSWORD 建立第一個管理者。
 * 有帳號之後這裡就關閉，其他帳號都從「後台管理 → 使用者管理」建立。
 */

/** GET /api/auth/setup → { needed } */
export async function GET() {
  try {
    await connectDB();
    return Response.json({ needed: !(await AdminUser.exists({})) });
  } catch (err) {
    return handleError(err);
  }
}

/** POST /api/auth/setup { setupPassword, email, name, password } */
export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    if (!origin || new URL(origin).host !== new URL(req.url).host) throw new HttpError(403, "來源不正確");
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) throw new HttpError(500, "伺服器尚未設定 ADMIN_PASSWORD");
    await connectDB();
    if (await AdminUser.exists({})) throw new HttpError(409, "已經有帳號了，請直接登入");

    const body = await readJson(req);
    if (!safeEqual(String(body.setupPassword ?? ""), expected)) {
      await new Promise((r) => setTimeout(r, 1000));
      throw new HttpError(401, "初始密碼（ADMIN_PASSWORD）不對");
    }
    const email = normEmail(body.email);
    assertEmail(email);
    assertPassword(body.password);
    const doc = await AdminUser.create({
      _id: crypto.randomUUID(),
      email,
      name: String(body.name ?? "").trim(),
      role: "admin",
      passwordHash: await hashPassword(body.password),
      lastLoginAt: new Date(),
    });
    const user = publicUser(doc.toObject() as unknown as Record<string, unknown>);
    const res = NextResponse.json(user, { status: 201 });
    res.cookies.set(sessionCookie(signSession({ userId: user.id, role: "admin" })));
    return res;
  } catch (err) {
    return handleError(err);
  }
}
