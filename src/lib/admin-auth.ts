import { cookies } from "next/headers";
import { hmacHex, safeEqual } from "./sign";

/* 管理後台登入：密碼放在環境變數 ADMIN_PASSWORD，登入後發 30 天的簽章 cookie */

export const ADMIN_COOKIE = "chou_admin";
const DAYS = 30;

const password = () => process.env.ADMIN_PASSWORD || "";
// 改密碼後舊的登入全部失效
const sessionKey = () => hmacHex(password(), "chou-line-bot-admin-session");

export function checkPassword(input: string) {
  const p = password();
  if (!p) return false;
  return safeEqual(hmacHex("pw", input), hmacHex("pw", p));
}

export function newSession() {
  const exp = Math.floor(Date.now() / 1000) + DAYS * 86400;
  return { value: `${exp}.${hmacHex(sessionKey(), `admin:${exp}`)}`, maxAge: DAYS * 86400 };
}

function validSession(v: string | undefined) {
  if (!v || !password()) return false;
  const m = /^(\d{9,11})\.([0-9a-f]{64})$/.exec(v);
  if (!m || Number(m[1]) < Date.now() / 1000) return false;
  return safeEqual(m[2], hmacHex(sessionKey(), `admin:${m[1]}`));
}

/** 呼叫後台 API 的人有沒有登入；POST 另外檢查是不是從本站送出（防跨站請求） */
export async function isAdmin(req: Request) {
  if (!validSession((await cookies()).get(ADMIN_COOKIE)?.value)) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (!origin || new URL(origin).host !== new URL(req.url).host) return false;
  }
  return true;
}

export const unauthorized = () => Response.json({ error: "請先登入" }, { status: 401 });
