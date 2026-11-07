import { NextResponse } from "next/server";
import { SESSION_COOKIE, UNLOCK_COOKIE } from "@/lib/session";

/** POST /api/auth/logout 清掉登入與驗證碼解鎖 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(UNLOCK_COOKIE);
  return res;
}
