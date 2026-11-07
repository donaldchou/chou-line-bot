import { safeEqual } from "@/lib/sign";
import { runFollowups } from "@/lib/followup";
import { runDueBroadcasts } from "@/lib/broadcast";

export const maxDuration = 60;

/**
 * cron-job.org 呼叫：/api/cron/followup?key=CRON_SECRET（或標頭 x-cron-key）
 * 做兩件事：6 小時關心、傳到時間的排程群發。建議每 10～15 分鐘一次（群發會準時一點）。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const key = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-cron-key") ?? "";
  if (!secret || !safeEqual(key, secret)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const broadcasts = await runDueBroadcasts().catch((e) => ({ error: String(e) }));
  const r = await runFollowups();
  return Response.json({ ok: true, ...r, broadcasts });
}
