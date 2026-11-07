import { NextResponse } from "next/server";
import { assertUnlockCode, handleError, HttpError, readJson, requireAdmin, requireUser, unlockedUntil } from "@/lib/auth";
import { signUnlock, UNLOCK_COOKIE, UNLOCK_HOURS, unlockCookie } from "@/lib/session";

/**
 * 驗證碼解鎖：後台輸入一次驗證碼，選定的時數內（1–12 小時，預設 1）後台的新增／修改／刪除都不用再輸入。
 * 解鎖憑證存在 HttpOnly cookie，綁定目前登入的使用者；登出時一併清掉。
 */

/** GET → { expiresAt }：解鎖中回傳到期時間（毫秒），否則 null */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return Response.json({ expiresAt: await unlockedUntil(user.id) });
  } catch (err) {
    return handleError(err);
  }
}

/** POST { code, hours? } */
export async function POST(req: Request) {
  try {
    const user = await requireAdmin(req);
    const body = await readJson(req);
    const hours = Number(body.hours ?? UNLOCK_HOURS.default);
    if (!Number.isInteger(hours) || hours < UNLOCK_HOURS.min || hours > UNLOCK_HOURS.max) {
      throw new HttpError(400, `解鎖時數需為 ${UNLOCK_HOURS.min}–${UNLOCK_HOURS.max} 小時`);
    }
    assertUnlockCode(String(body.code ?? ""));
    const { token, expiresAt } = signUnlock(user.id, hours);
    const res = NextResponse.json({ expiresAt });
    res.cookies.set(unlockCookie(token, hours));
    return res;
  } catch (err) {
    return handleError(err);
  }
}

/** DELETE 提前鎖定 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(UNLOCK_COOKIE);
  return res;
}
