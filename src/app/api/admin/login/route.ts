import { cookies } from "next/headers";
import { ADMIN_COOKIE, checkPassword, newSession } from "@/lib/admin-auth";

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(req.url).host) return Response.json({ error: "來源不正確" }, { status: 403 });
  if (!process.env.ADMIN_PASSWORD) return Response.json({ error: "還沒設定 ADMIN_PASSWORD 環境變數" }, { status: 500 });
  const body = (await req.json().catch(() => ({}))) as { password?: unknown };
  if (!checkPassword(String(body.password ?? ""))) {
    await new Promise((r) => setTimeout(r, 1000)); // 減慢猜密碼
    return Response.json({ error: "密碼不對" }, { status: 401 });
  }
  const s = newSession();
  (await cookies()).set(ADMIN_COOKIE, s.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: s.maxAge,
  });
  return Response.json({ ok: true });
}

export async function DELETE() {
  (await cookies()).delete(ADMIN_COOKIE);
  return Response.json({ ok: true });
}
