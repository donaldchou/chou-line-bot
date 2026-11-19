import { cronStatus } from "@/lib/cron-stat";

/**
 * ll3 後台 admin.asp「API 排程狀態」用瀏覽器讀取（ll3 主機本身連不上 Vercel 的 TLS）
 * 只回時間、次數、結果，不需要 key；只允許 ll3.com.tw 的網頁跨網域讀取
 */
function headers(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const ok = /^https?:\/\/(www\.)?ll3\.com\.tw$/i.test(origin);
  return {
    ...(ok ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
    "cache-control": "no-store",
  };
}

export async function GET(req: Request) {
  const h = headers(req);
  try {
    return Response.json({ ok: true, ...(await cronStatus()) }, { headers: h });
  } catch (e) {
    console.error("cron status", e);
    return Response.json({ ok: false, error: "db" }, { status: 500, headers: h });
  }
}
