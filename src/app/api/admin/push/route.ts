import { segmentMembers } from "@/lib/admin-data";
import { assertCode, handleError, HttpError, readJson, requireAdmin, requirePage } from "@/lib/auth";
import { BroadcastError, broadcastPage, cancelBroadcast, createBroadcast, parseInput, testBroadcast } from "@/lib/broadcast";

export const maxDuration = 60;

const wrap = (e: unknown) => (e instanceof BroadcastError ? new HttpError(400, e.message) : e);

export async function GET(req: Request) {
  try {
    await requirePage(req, "push");
    return Response.json(await broadcastPage());
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST { action: "preview", segs }                         → 會傳給幾位
 * POST { action: "test", segs, text, cards, orderButton, userId } → 先傳給一位看看
 * POST { action: "send", segs, text, cards, orderButton, when: "now" | ISO 時間 } → 群發（需要驗證碼）
 * POST { action: "cancel", id }                            → 取消還沒傳的排程
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    const body = await readJson(req);
    try {
      switch (body.action) {
        case "preview": {
          const segs = Array.isArray(body.segs) ? body.segs.map(String) : [];
          const m = await segmentMembers(segs);
          return Response.json({ count: m.ids.length, total: m.total, excluded: m.excluded });
        }
        case "test": {
          const userId = String(body.userId ?? "");
          if (!/^U[0-9a-f]{32}$/.test(userId)) throw new HttpError(400, "請選要測試的 LINE 好友");
          await testBroadcast(parseInput(body), userId);
          return Response.json({ ok: true });
        }
        case "send": {
          await assertCode(req, admin, "群發");
          const input = parseInput(body);
          const when = body.when === "now" ? "now" : new Date(String(body.when ?? ""));
          if (when !== "now" && Number.isNaN(when.getTime())) throw new HttpError(400, "排定時間不對");
          const b = await createBroadcast(input, when, admin.email);
          return Response.json({ ok: true, status: b.status, sent: "sent" in b ? b.sent : 0 });
        }
        case "cancel":
          await cancelBroadcast(String(body.id ?? ""));
          return Response.json({ ok: true });
        default:
          throw new HttpError(400, "不支援的動作");
      }
    } catch (e) {
      throw wrap(e);
    }
  } catch (err) {
    return handleError(err);
  }
}
