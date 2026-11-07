import { hmacHex, safeEqual } from "./sign";
import type { Role } from "./page-access";

/**
 * 登入憑證：簽發、驗證和 cookie 設定（照 chou-platform，但不用 JWT 套件，改用 HMAC 簽章）。
 * 這裡不碰資料庫，proxy 也能用。密鑰讀環境變數 AUTH_SECRET（至少 32 個字元）。
 * 憑證格式：base64url(JSON).HMAC
 */
export const SESSION_COOKIE = "chou_line_session";
export const SESSION_DAYS = 7;

export type Session = { userId: string; role: Role };

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("請在 .env.local 設定 AUTH_SECRET（至少 32 個字元）");
  return s;
}

function sign(payload: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmacHex(secret(), body)}`;
}

function verify(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const m = /^([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/.exec(token);
  if (!m) return null;
  try {
    if (!safeEqual(m[2], hmacHex(secret(), m[1]))) return null;
    const p = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof p.exp === "number" && p.exp * 1000 > Date.now() ? p : null;
  } catch {
    return null;
  }
}

export function signSession(s: Session) {
  return sign({ p: "session", sub: s.userId, role: s.role, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400 });
}

/** 驗證憑證；過期、被竄改或格式不對都回傳 null */
export function verifySession(token: string | undefined): Session | null {
  const p = verify(token);
  if (!p || p.p !== "session" || typeof p.sub !== "string") return null;
  return { userId: p.sub, role: p.role === "admin" ? "admin" : "user" };
}

export const sessionCookie = (token: string) => ({
  name: SESSION_COOKIE,
  value: token,
  httpOnly: true, // 前端 JavaScript 讀不到，避免被 XSS 偷走
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DAYS * 86400,
});

/* ---------------- 驗證碼解鎖：後台輸入一次驗證碼，選定的時數內不用再輸入 ---------------- */
export const UNLOCK_COOKIE = "chou_line_unlock";
/** 後台解鎖可選的時數：預設 1 小時，最多 12 小時 */
export const UNLOCK_HOURS = { min: 1, max: 12, default: 1 } as const;

/** 綁定登入者的解鎖憑證，回傳 token 與到期時間（毫秒） */
export function signUnlock(userId: string, hours: number) {
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  return { token: sign({ p: "unlock", sub: userId, exp }), expiresAt: exp * 1000 };
}

/** 解鎖憑證有效（同一個使用者、還沒過期）時回傳到期時間（毫秒），否則 null */
export function verifyUnlock(token: string | undefined, userId: string): number | null {
  const p = verify(token);
  if (!p || p.p !== "unlock" || p.sub !== userId) return null;
  return (p.exp as number) * 1000;
}

export const unlockCookie = (token: string, hours: number) => ({
  name: UNLOCK_COOKIE,
  value: token,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: hours * 3600,
});
