import { capacityPage, saveCapReplies, saveProductSetting, type CapStatus } from "@/lib/capacity";
import { handleError, HttpError, readJson, requireAdmin, requirePage } from "@/lib/auth";
import { isSys } from "@/lib/ll3";

export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    await requirePage(req, "capacity");
    return Response.json(await capacityPage());
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST { sys, productId, status?, cap? }  改一個品項
 * POST { replies: { full, stop } }        改額滿／停止接單時的回覆
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    const body = await readJson(req);
    if (body.replies && typeof body.replies === "object") {
      const r = body.replies as Record<string, unknown>;
      const full = String(r.full ?? "").trim().slice(0, 300);
      const stop = String(r.stop ?? "").trim().slice(0, 300);
      if (!full || !stop) throw new HttpError(400, "回覆不能空白");
      await saveCapReplies({ full, stop });
      return Response.json({ ok: true });
    }
    if (!isSys(body.sys)) throw new HttpError(400, "sys 不對");
    const productId = String(body.productId ?? "").trim();
    if (!/^[\w-]{1,40}$/.test(productId)) throw new HttpError(400, "貨號不對");
    const patch: { status?: CapStatus; cap?: number | null } = {};
    if (body.status !== undefined) {
      if (!["open", "full", "stop"].includes(String(body.status))) throw new HttpError(400, "狀態不對");
      patch.status = body.status as CapStatus;
    }
    if (body.cap !== undefined) {
      if (body.cap === null || body.cap === "") patch.cap = null;
      else {
        const n = Number(body.cap);
        if (!Number.isInteger(n) || n < 0 || n > 100000) throw new HttpError(400, "上限要是 0 以上的整數");
        patch.cap = n;
      }
    }
    await saveProductSetting(body.sys, productId, patch, admin.email);
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
