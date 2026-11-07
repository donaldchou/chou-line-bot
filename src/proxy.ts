import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * 後台頁面都要登入（LINE webhook、ll3 通知、排程等 API 不經過這裡）。
 * 這裡只驗證憑證簽章（不查資料庫），真正的權限（帳號停用、頁面權限、管理者才能修改）由各個 API 再檢查一次。
 */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const session = verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    // 已登入還開登入頁，直接進後台
    return session ? NextResponse.redirect(new URL("/admin", req.url)) : NextResponse.next();
  }

  if (!session) {
    const login = new URL("/login", req.url);
    if (pathname !== "/admin") login.searchParams.set("next", pathname + search);
    const res = NextResponse.redirect(login);
    if (req.cookies.has(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  // 後台管理只給管理者
  if (session.role !== "admin" && /^\/admin\/system(\/|$)/.test(pathname)) {
    return NextResponse.redirect(new URL("/admin", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/login"],
};
