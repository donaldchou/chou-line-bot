import { safeEqual } from "@/lib/sign";
import { runFollowups } from "@/lib/followup";
import { runDueBroadcasts } from "@/lib/broadcast";
import { logCronBadKey, logCronCall } from "@/lib/cron-stat";

export const maxDuration = 60;

/**
 * cron-job.org 呼叫：/api/cron/followup?key=CRON_SECRET（或標頭 x-cron-key）
 * 做兩件事：6 小時關心、傳到時間的排程群發。建議每 10～15 分鐘一次（群發會準時一點）。
 * 每次呼叫記在 cronStats（ll3 後台 admin.asp「API 排程狀態」經 /api/cron/status 讀取）
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const key = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-cron-key") ?? "";
  if (!secret || !safeEqual(key, secret)) {
    await logCronBadKey().catch((e) => console.error("logCronBadKey", e));
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const broadcasts = await runDueBroadcasts().catch((e) => ({ error: String(e) }));
  let r: Awaited<ReturnType<typeof runFollowups>> | { error: string };
  try {
    r = await runFollowups();
  } catch (e) {
    r = { error: String(e) };
  }
  await logCronCall({ followups: r, broadcasts }).catch((e) => console.error("logCronCall", e));
  if ("error" in r && !("checked" in r)) return Response.json({ ok: false, ...r, broadcasts }, { status: 500 });
  return Response.json({ ok: true, ...r, broadcasts });
}
