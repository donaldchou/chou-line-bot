import { clearOrderCache, orderList } from "@/lib/admin-data";
import { handleError, requireAdmin, requirePage } from "@/lib/auth";
import { isSys } from "@/lib/ll3";
import { notifyShipped, NotifyError } from "@/lib/notify";

export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    await requirePage(req, "orders");
    const range = new URL(req.url).searchParams.get("range") ?? "week";
    return Response.json(await orderList(["today", "week", "month", "season"].includes(range) ? range : "week"));
  } catch (err) {
    return handleError(err);
  }
}

/** 「LINE 通知寄出」按鈕：只有管理者 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
  } catch (err) {
    return handleError(err);
  }
  const body = (await req.json().catch(() => ({}))) as { sys?: unknown; orderId?: unknown };
  const orderId = Number(body.orderId);
  if (!isSys(body.sys) || !Number.isInteger(orderId) || orderId <= 0) return Response.json({ error: "參數錯誤" }, { status: 400 });
  try {
    const r = await notifyShipped(body.sys, orderId);
    clearOrderCache();
    return Response.json({ ok: true, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: e instanceof NotifyError ? 422 : 502 });
  }
}
