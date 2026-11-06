import { createHmac, timingSafeEqual } from "node:crypto";

export function hmacHex(key: string, msg: string) {
  return createHmac("sha256", key).update(msg, "utf8").digest("hex");
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 與 ll3 line_config.asp 相同的通行證：「UTC 秒數.HMAC(purpose:秒數)」 */
export function ll3Token(purpose: string) {
  const key = process.env.LL3_LINE_KEY;
  if (!key) throw new Error("請在 .env.local 設定 LL3_LINE_KEY");
  const ts = Math.floor(Date.now() / 1000);
  return `${ts}.${hmacHex(key, `${purpose}:${ts}`)}`;
}

/** 檢查 ll3 發的通行證（300 秒內有效） */
export function checkLl3Token(token: string | null, purpose: string) {
  const key = process.env.LL3_LINE_KEY;
  if (!key || !token) return false;
  const m = /^(\d{9,11})\.([0-9a-f]{64})$/.exec(token.trim());
  if (!m) return false;
  if (Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  return safeEqual(m[2], hmacHex(key, `${purpose}:${m[1]}`));
}

/** 圖片網址簽章（LINE 讀圖時不會帶任何驗證，用簽章避免被亂抓） */
export function imgSig(...parts: string[]) {
  const key = process.env.IMG_SIGN_KEY || process.env.LL3_LINE_KEY || "";
  return hmacHex(key, parts.join("|")).slice(0, 24);
}

export function checkImgSig(sig: string | null, ...parts: string[]) {
  return !!sig && safeEqual(sig, imgSig(...parts));
}
