import { safeEqual } from "@/lib/sign";
import { runFollowups } from "@/lib/followup";

export const maxDuration = 60;

/** cron-job.org 每小時呼叫：/api/cron/followup?key=CRON_SECRET（或標頭 x-cron-key） */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const key = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-cron-key") ?? "";
  if (!secret || !safeEqual(key, secret)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const r = await runFollowups();
  return Response.json({ ok: true, ...r });
}
