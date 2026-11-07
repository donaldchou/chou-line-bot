import mongoose from "mongoose";
import { assertCode, handleError, HttpError, requireAdmin } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";

/**
 * 後台「所有資料」：列出資料庫裡每個集合，可以搜尋、檢視原始資料、刪除（刪除需要驗證碼）。
 * 登入帳號（adminUsers）不在這裡，從「使用者管理」改。
 */
const COLLS = {
  lineUsers: { label: "LINE 好友（客戶）", sort: { lastAt: -1 }, search: ["_id", "displayName", "contact.name", "contact.phone", "memo"] },
  messages: { label: "對話紀錄", sort: { at: -1 }, search: ["text", "userId"] },
  orderDrafts: { label: "訂單草稿／確認卡", sort: { createdAt: -1 }, search: ["_id", "userId", "data.buyerName", "data.buyerPhone"] },
  notifyLogs: { label: "寄出通知紀錄", sort: { at: -1 }, search: ["userId", "error", "sys"] },
  alertLogs: { label: "需要處理紀錄（轉真人）", sort: { at: -1 }, search: ["userId", "text", "kind"] },
  broadcasts: { label: "群發訊息", sort: { scheduledAt: -1 }, search: ["text", "status", "createdBy"] },
  productSettings: { label: "接單設定（各規格）", sort: { _id: 1 }, search: ["_id", "status"] },
  webhookEvents: { label: "LINE 事件去重（2 天自動清除）", sort: { at: -1 }, search: ["_id"] },
  adminSettings: { label: "後台設定", sort: { _id: 1 }, search: ["_id"] },
} as const;
type Coll = keyof typeof COLLS;
const isColl = (v: unknown): v is Coll => typeof v === "string" && v in COLLS;

const PAGE = 50;

async function db() {
  await connectDB();
  return mongoose.connection.db!;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** _id 可能是字串（LINE userId、訂單 ref）或 ObjectId */
function idFilter(id: string) {
  const ids: unknown[] = [id];
  if (/^[0-9a-f]{24}$/.test(id)) ids.push(new mongoose.Types.ObjectId(id));
  return { _id: { $in: ids } } as Record<string, unknown>;
}

const get = (d: Record<string, unknown>, path: string) =>
  path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), d);

const fmt = (v: unknown) => (v instanceof Date ? v.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : v == null ? "" : String(v));

/** 列表上顯示的簡短說明 */
function summary(c: Coll, d: Record<string, unknown>) {
  const pick = (...paths: string[]) => paths.map((p) => fmt(get(d, p))).filter(Boolean).slice(0, 4).join("・");
  switch (c) {
    case "lineUsers":
      return pick("displayName", "contact.name", "stage", "lastAt");
    case "messages":
      return `${d.role === "user" ? "客人" : d.by === "admin" ? "農場" : "機器人"}：${String(d.text ?? "").slice(0, 60)}・${fmt(d.at)}`;
    case "orderDrafts":
      return pick("data.buyerName", "status", "quote.total", "createdAt");
    case "notifyLogs":
      return pick("sys", "orderId", "ok", "at");
    default:
      return pick("at");
  }
}

/**
 * GET                 → { collections: [{ key, label, count }] }
 * GET ?c=&q=&page=    → { rows: [{ id, summary, fields, doc }], total, page, pages }
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const d = await db();
    const p = new URL(req.url).searchParams;
    const c = p.get("c");
    if (!c) {
      const collections = await Promise.all(
        (Object.keys(COLLS) as Coll[]).map(async (k) => ({ key: k, label: COLLS[k].label, count: await d.collection(k).estimatedDocumentCount() })),
      );
      return Response.json({ collections });
    }
    if (!isColl(c)) throw new HttpError(400, "沒有這個集合");
    const q = (p.get("q") ?? "").trim().slice(0, 100);
    const filter = q ? { $or: COLLS[c].search.map((f) => ({ [f]: { $regex: escapeRe(q), $options: "i" } })) } : {};
    const col = d.collection(c);
    const total = await col.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const page = Math.min(pages, Math.max(1, Number(p.get("page")) || 1));
    const docs = await col
      .find(filter)
      .sort(COLLS[c].sort as Record<string, 1 | -1>)
      .skip((page - 1) * PAGE)
      .limit(PAGE)
      .toArray();
    return Response.json({
      rows: docs.map((doc) => ({ id: String(doc._id), summary: summary(c, doc), fields: Object.keys(doc).length, doc })),
      total,
      page,
      pages,
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * DELETE ?c=&id=&cascade=1 刪除一筆（需要驗證碼）。
 * 刪 LINE 好友時，如果還有對話紀錄或訂單草稿，先回 409 needsCascade，確認後帶 cascade=1 一併刪除。
 */
export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin(req);
    await assertCode(req, admin, "刪除");
    const d = await db();
    const p = new URL(req.url).searchParams;
    const c = p.get("c");
    const id = p.get("id") ?? "";
    if (!isColl(c) || !id) throw new HttpError(400, "參數錯誤");

    if (c === "lineUsers") {
      const [msgs, drafts] = await Promise.all([
        d.collection("messages").countDocuments({ userId: id }),
        d.collection("orderDrafts").countDocuments({ userId: id }),
      ]);
      if ((msgs || drafts) && p.get("cascade") !== "1") {
        throw new HttpError(409, `這位客戶還有 ${msgs} 則對話紀錄、${drafts} 筆訂單草稿，要一併刪除嗎？（ll3 訂單系統裡的訂單不會被刪）`, {
          needsCascade: true,
        });
      }
      await d.collection("messages").deleteMany({ userId: id });
      await d.collection("orderDrafts").deleteMany({ userId: id });
    }
    const res = await d.collection(c).deleteOne(idFilter(id));
    if (!res.deletedCount) throw new HttpError(404, "找不到這筆資料");
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
