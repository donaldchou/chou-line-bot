import { safeEqual } from "@/lib/sign";
import { runFollowups } from "@/lib/followup";
import { runDueBroadcasts } from "@/lib/broadcast";
import { logCronCall } from "@/lib/ll3";

export const maxDuration = 60;

type Followups = Awaited<ReturnType<typeof runFollowups>>;
type Broadcasts = Awaited<ReturnType<typeof runDueBroadcasts>> | { error: string };

/** ll3 Line_Cron_Api.last_result：「ok|quiet|err|符合條件|已傳|失敗位數|群發已送|錯誤訊息」 */
function resultText(f: Followups | { error: string }, b: Broadcasts) {
  const errs: string[] = [];
  let head: string;
  if ("error" in f) {
    head = "err|0|0|0";
    errs.push(`關心：${f.error}`);
  } else if ("skipped" in f) {
    head = "quiet|0|0|0";
  } else {
    head = `ok|${f.checked}|${f.sent}|${f.errors.length}`;
    if (f.errors.length) errs.push(`關心傳送：${f.errors[0]}`);
  }
  if ("error" in b) errs.push(`群發：${b.error}`);
  const bSent = "error" in b ? -1 : b.sent;
  return `${head}|${bSent}|${errs.join("；").replace(/\|/g, "/").slice(0, 150)}`;
}

/**
 * cron-job.org 呼叫：/api/cron/followup?key=CRON_SECRET（或標頭 x-cron-key）
 * 做兩件事：6 小時關心、傳到時間的排程群發。建議每 10～15 分鐘一次（群發會準時一點）。
 * 每次呼叫記到 ll3 system.mdb（/ll3_admin/admin.asp「API 排程狀態」顯示）；ll3 連不上不影響本次工作
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const key = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-cron-key") ?? "";
  if (!secret || !safeEqual(key, secret)) {
    await logCronCall("bad").catch((e) => console.error("logCronCall bad", e));
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const broadcasts: Broadcasts = await runDueBroadcasts().catch((e) => ({ error: String(e) }));
  let r: Followups | { error: string };
  try {
    r = await runFollowups();
  } catch (e) {
    r = { error: String(e) };
  }
  await logCronCall("ok", resultText(r, broadcasts)).catch((e) => console.error("logCronCall", e));
  if ("error" in r) return Response.json({ ok: false, ...r, broadcasts }, { status: 500 });
  return Response.json({ ok: true, ...r, broadcasts });
}
