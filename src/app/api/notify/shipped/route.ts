import { checkLl3Token } from "@/lib/sign";
import { isSys } from "@/lib/ll3";
import { notifyShipped, NotifyError } from "@/lib/notify";

export const maxDuration = 60;

/** ll3 後台 vieworder_suda.asp 的瀏覽器呼叫（ll3 主機本身連不上 Vercel 的 TLS） */
function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const ok = /^https?:\/\/(www\.)?ll3\.com\.tw$/i.test(origin);
  return {
    ...(ok ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-line-token",
    "access-control-max-age": "600",
  };
}

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req) });
}

export async function POST(req: Request) {
  const headers = cors(req);
  const body = (await req.json().catch(() => ({}))) as { sys?: unknown; orderId?: unknown };
  const orderId = Number(body.orderId);
  if (!isSys(body.sys) || !Number.isInteger(orderId) || orderId <= 0) {
    return Response.json({ ok: false, error: "參數錯誤" }, { status: 400, headers });
  }
  if (!checkLl3Token(req.headers.get("x-line-token"), `notify:${body.sys}:${orderId}`)) {
    return Response.json({ ok: false, error: "通行證無效或已過期，請重新整理頁面再試" }, { status: 401, headers });
  }
  try {
    const r = await notifyShipped(body.sys, orderId);
    return Response.json({ ok: true, ...r }, { headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: e instanceof NotifyError ? 422 : 502, headers });
  }
}
