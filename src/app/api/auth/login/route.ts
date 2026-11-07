import { NextResponse } from "next/server";
import { checkPassword, handleError, HttpError, normEmail, publicUser, readJson } from "@/lib/auth";
import { AdminUser } from "@/lib/models";
import { connectDB } from "@/lib/mongodb";
import { sessionCookie, signSession } from "@/lib/session";

// 同一個 email 連續輸錯太多次就暫停一下，降低被猜密碼的機會（記在記憶體，重啟後歸零）
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const fails = new Map<string, { count: number; until: number }>();

/** POST /api/auth/login { email, password } → 設定登入 cookie */
export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    if (!origin || new URL(origin).host !== new URL(req.url).host) throw new HttpError(403, "來源不正確");
    const body = await readJson(req);
    const email = normEmail(body.email);
    const password = String(body.password ?? "");
    if (!email || !password) throw new HttpError(400, "請輸入 email 和密碼");

    const f = fails.get(email);
    if (f && f.count >= MAX_FAILS && f.until > Date.now()) throw new HttpError(429, "輸錯太多次，請 15 分鐘後再試");

    await connectDB();
    const doc = await AdminUser.findOne({ email }).lean();
    // 帳號不存在和密碼錯誤回同樣的訊息，不讓人試出哪些 email 有帳號
    if (!doc || !(await checkPassword(password, doc.passwordHash))) {
      const count = f && f.until > Date.now() ? f.count + 1 : 1;
      fails.set(email, { count, until: Date.now() + LOCK_MS });
      await new Promise((r) => setTimeout(r, 800));
      throw new HttpError(401, "email 或密碼錯誤");
    }
    if (!doc.active) throw new HttpError(403, "這個帳號已停用，請聯絡管理者");
    fails.delete(email);

    const user = publicUser(doc as unknown as Record<string, unknown>);
    await AdminUser.updateOne({ _id: user.id }, { lastLoginAt: new Date() });
    const res = NextResponse.json(user);
    res.cookies.set(sessionCookie(signSession({ userId: user.id, role: user.role })));
    return res;
  } catch (err) {
    return handleError(err);
  }
}
