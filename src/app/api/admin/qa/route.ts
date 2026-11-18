import { assertCode, handleError, HttpError, readJson, requireAdmin, requirePage } from "@/lib/auth";
import { FIXED_RULES } from "@/lib/knowledge";
import { deleteItem, linkAlert, parseDraft, QaError, qaPage, saveCategories, saveItem, setActive } from "@/lib/qa";
import { replyCustomer } from "@/lib/qa-answer";

export const maxDuration = 60;

const isOid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{24}$/.test(v);
const isQaId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,40}$/.test(v);

export async function GET(req: Request) {
  try {
    await requirePage(req, "qa");
    return Response.json({ ...(await qaPage()), fixed: FIXED_RULES });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * 都要驗證碼（header x-verify-code，或後台解鎖期間）。
 * POST { action: "save", id?, cat, q, alt, a, notify, productPhotos, pricePhotos, sendMode, alertId?, reply?, replyText? }
 *      新增／修改問答；從「答不出來的問題」來的會記下對應，reply＝順便用 LINE 回覆那位客人
 * POST { action: "toggle", id, active }
 * POST { action: "delete", id }
 * POST { action: "cats", cats: [{ id?, name }] }   分類（整份清單，照順序）
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    const body = await readJson(req);
    await assertCode(req, admin, body.action === "delete" ? "刪除" : body.action === "save" && !body.id ? "新增" : "修改");
    switch (body.action) {
      case "save": {
        if (body.id !== undefined && !isQaId(body.id)) throw new HttpError(400, "id 不對");
        if (body.alertId !== undefined && !isOid(body.alertId)) throw new HttpError(400, "alertId 不對");
        const draft = await parseDraft(body);
        const id = await saveItem(draft, admin.email, body.id as string | undefined);
        let replied: string | null = null;
        let replyError: string | null = null;
        if (body.alertId) {
          await linkAlert(body.alertId as string, id, admin.email);
          if (body.reply === true) {
            // 問答已經存好；回覆失敗只提示，不算存檔失敗
            try {
              replied = await replyCustomer(body.alertId as string, typeof body.replyText === "string" ? body.replyText : undefined);
            } catch (e) {
              replyError = e instanceof Error ? e.message : String(e);
            }
          }
        }
        return Response.json({ ok: true, id, replied, replyError });
      }
      case "toggle":
        if (!isQaId(body.id)) throw new HttpError(400, "id 不對");
        await setActive(body.id, body.active === true, admin.email);
        return Response.json({ ok: true });
      case "delete":
        if (!isQaId(body.id)) throw new HttpError(400, "id 不對");
        await deleteItem(body.id, admin.email);
        return Response.json({ ok: true });
      case "cats":
        await saveCategories(body.cats);
        return Response.json({ ok: true });
      default:
        throw new HttpError(400, "不支援的動作");
    }
  } catch (err) {
    if (err instanceof QaError) return Response.json({ error: err.message }, { status: 400 });
    return handleError(err);
  }
}
