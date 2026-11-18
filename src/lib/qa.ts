import { randomBytes } from "node:crypto";
import { connectDB } from "./mongodb";
import { AdminSetting, AlertLog, LineUser, QaCategory, QaItem, type QaCategoryDoc, type QaItemDoc, type QaSendMode } from "./models";
import { SEED_CATEGORIES, SEED_QA } from "./knowledge";
import { deletePhoto, PHOTO_NAME } from "./ll3-file";

/** 試問時還沒存檔的那則問答，get_qa_answer 用這個 id */
export const DRAFT_ID = "draft";

/* 問答管理：機器人回答客人時參考的問答，存在資料庫，後台改了立刻生效 */

export class QaError extends Error {}

const SEED_FLAG = "qaSeeded";
let seeded = false;

/** 第一次使用時寫入預設分類與問答（只做一次；之後刪掉的不會再跑回來） */
export async function ensureSeed() {
  if (seeded) return;
  await connectDB();
  if (!(await AdminSetting.findById(SEED_FLAG).lean())) {
    const now = new Date();
    await QaCategory.bulkWrite(
      SEED_CATEGORIES.map(({ _id, ...c }) => ({
        updateOne: { filter: { _id }, update: { $setOnInsert: { ...c, createdAt: now } }, upsert: true },
      })),
    );
    await QaItem.bulkWrite(
      SEED_QA.map(({ _id, notify, ...s }) => ({
        updateOne: {
          filter: { _id },
          update: { $setOnInsert: { ...s, notify: !!notify, active: true, createdAt: now, updatedAt: now, updatedBy: "system" } },
          upsert: true,
        },
      })),
    );
    await AdminSetting.updateOne({ _id: SEED_FLAG }, { $set: { at: now } }, { upsert: true });
  }
  seeded = true;
}

export interface QaDraft {
  cat: string;
  q: string;
  alt: string;
  a: string;
  notify: boolean;
  productPhotos: string[];
  pricePhotos: string[];
  sendMode: QaSendMode;
}

export const MAX_PHOTOS = 10;
export const SEND_MODES: QaSendMode[] = ["text", "photo", "text_photo", "photo_text"];

const newId = () => randomBytes(6).toString("hex");
const s = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const photoList = (v: unknown, label: string) => {
  const list = [...new Set((Array.isArray(v) ? v : []).map(String))];
  if (list.some((n) => !PHOTO_NAME.test(n))) throw new QaError(`${label}的檔名不對`);
  if (list.length > MAX_PHOTOS) throw new QaError(`${label}最多 ${MAX_PHOTOS} 張`);
  return list;
};
export const photoCount = (d: Pick<QaDraft, "productPhotos" | "pricePhotos">) => (d.productPhotos?.length ?? 0) + (d.pricePhotos?.length ?? 0);
/** 「產品照片 3 張、價格照片 1 張」 */
export const photoSummary = (d: Pick<QaDraft, "productPhotos" | "pricePhotos">) =>
  [d.productPhotos?.length && `產品照片 ${d.productPhotos.length} 張`, d.pricePhotos?.length && `價格照片 ${d.pricePhotos.length} 張`].filter(Boolean).join("、");
/** 回答裡的網址（客人一定要拿到，AI 漏掉時系統補上） */
export const linksIn = (text: string) => [...new Set(text.match(/https?:\/\/[^\s，。、「」（）()<>]+/g) ?? [])];
/** 這題要經過 get_qa_answer（有照片或網址） */
export const viaTool = (d: Pick<QaDraft, "productPhotos" | "pricePhotos" | "sendMode" | "a">) => sendsPhotos(d) || linksIn(d.a ?? "").length > 0;
/** 這題會傳照片（有照片、而且不是「只傳文字」） */
export const sendsPhotos = (d: Pick<QaDraft, "productPhotos" | "pricePhotos" | "sendMode">) => photoCount(d) > 0 && (d.sendMode ?? "text") !== "text";

/** 檢查並整理後台送來的問答 */
export async function parseDraft(body: Record<string, unknown>): Promise<QaDraft> {
  const d: QaDraft = {
    cat: s(body.cat, 40),
    q: s(body.q, 200),
    alt: s(body.alt, 300),
    a: s(body.a, 2000),
    notify: body.notify === true,
    productPhotos: photoList(body.productPhotos, "產品照片"),
    pricePhotos: photoList(body.pricePhotos, "價格照片"),
    sendMode: SEND_MODES.includes(body.sendMode as QaSendMode) ? (body.sendMode as QaSendMode) : "text",
  };
  if (!d.q) throw new QaError("請填「客人會這樣問」");
  if (d.sendMode !== "text" && !photoCount(d)) throw new QaError("選了傳照片，請至少上傳一張照片，或改選「只傳文字」");
  if (!d.a && d.sendMode !== "photo") throw new QaError("請填回答");
  await connectDB();
  if (!(await QaCategory.exists({ _id: d.cat }))) throw new QaError("請選分類");
  return d;
}

async function sortedCats() {
  await ensureSeed();
  return QaCategory.find().sort({ sort: 1, createdAt: 1 }).lean<QaCategoryDoc[]>();
}

/**
 * 給機器人的問答文字（只含啟用的）。
 * override：試問時用還沒存檔的內容取代（id）或加入（沒有 id）一則。
 */
export async function qaPromptText(override?: { id?: string; draft: QaDraft }) {
  await ensureSeed();
  const [cats, items] = await Promise.all([sortedCats(), QaItem.find({ active: true }).sort({ createdAt: 1 }).lean<QaItemDoc[]>()]);
  let list: (QaDraft & { _id: string })[] = items;
  if (override) {
    list = items.filter((i) => i._id !== override.id);
    list.push({ ...override.draft, _id: DRAFT_ID });
  }
  return cats
    .map((c) => {
      const rows = list.filter((i) => i.cat === c._id);
      if (!rows.length) return "";
      const body = rows
        .map((i) => {
          const lines = [`- 客人問：${i.q}${i.alt ? `（也可能這樣問：${i.alt}）` : ""}`];
          // 有照片或網址的題目不直接給回答：AI 要呼叫 get_qa_answer 才拿得到回答，系統同時傳照片、補上漏掉的網址（不靠 AI 記得）
          if (viaTool(i)) lines.push(`  ※ 這題的回答在系統裡：一定要先呼叫 get_qa_answer(qa_id="${i._id}")，照它回傳的內容回覆`);
          else if (i.a) lines.push(`  回答重點：${i.a}`);
          if (i.notify) lines.push(`  ※ 回答這題後，同時呼叫 flag_customer(status="human", reason="客人問：${i.q}")`);
          return lines.join("\n");
        })
        .join("\n");
      return `【${c.name}】\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

/* ---------------- 後台頁面資料 ---------------- */

export interface QaView {
  id: string;
  cat: string;
  q: string;
  alt: string;
  a: string;
  notify: boolean;
  productPhotos: string[];
  pricePhotos: string[];
  sendMode: QaSendMode;
  active: boolean;
  updatedAt: string;
}
export interface CatView {
  id: string;
  name: string;
  count: number;
}
export interface UnansweredView {
  id: string;
  userId: string;
  name: string;
  /** 客人原話（舊紀錄沒有，改顯示機器人寫的說明） */
  question: string;
  reason: string;
  at: string;
  /** 已在對話頁回覆或按過已處理 */
  handled: boolean;
  qaId: string | null;
  qaQ: string | null;
  qaAt: string | null;
}

export async function qaPage() {
  await ensureSeed();
  const [cats, items] = await Promise.all([sortedCats(), QaItem.find().sort({ createdAt: 1 }).lean<QaItemDoc[]>()]);
  const logs = await AlertLog.find({ kind: "unanswered" }).sort({ at: -1 }).limit(300).lean();
  const users = await LineUser.find({ _id: { $in: [...new Set(logs.map((l) => l.userId))] } }, { displayName: 1, contact: 1 }).lean();
  const nameOf = new Map(users.map((u) => [u._id, u.contact?.name || u.displayName || "（沒有名稱）"]));
  const qOf = new Map(items.map((i) => [i._id, i.q]));
  const catOrder = new Map(cats.map((c, i) => [c._id, i]));
  const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

  return {
    categories: cats.map<CatView>((c) => ({ id: c._id, name: c.name, count: items.filter((i) => i.cat === c._id).length })),
    items: items
      .sort((a, b) => (catOrder.get(a.cat) ?? 99) - (catOrder.get(b.cat) ?? 99))
      .map<QaView>((i) => ({
        id: i._id,
        cat: i.cat,
        q: i.q,
        alt: i.alt,
        a: i.a,
        notify: i.notify,
        productPhotos: i.productPhotos ?? [],
        pricePhotos: i.pricePhotos ?? [],
        sendMode: i.sendMode ?? "text",
        active: i.active,
        updatedAt: iso(i.updatedAt)!,
      })),
    unanswered: logs.map<UnansweredView>((l) => ({
      id: String(l._id),
      userId: l.userId,
      name: nameOf.get(l.userId) ?? "（已刪除的客戶）",
      question: l.question || "",
      reason: l.text,
      at: iso(l.at)!,
      handled: !!l.resolvedAt,
      qaId: l.qaId ?? null,
      qaQ: l.qaId ? (qOf.get(l.qaId) ?? "（問答已刪除）") : null,
      qaAt: iso(l.qaAt),
    })),
  };
}
export type QaPageData = Awaited<ReturnType<typeof qaPage>>;

/* ---------------- 修改 ---------------- */

export async function saveItem(draft: QaDraft, by: string, id?: string) {
  await connectDB();
  const now = new Date();
  if (id) {
    const old = await QaItem.findOneAndUpdate({ _id: id }, { $set: { ...draft, updatedAt: now, updatedBy: by } }).lean<QaItemDoc>();
    if (!old) throw new QaError("找不到這則問答（可能已被刪除）");
    await cleanupPhotos(photosOf(old));
    return id;
  }
  const _id = newId();
  await QaItem.create({ _id, ...draft, active: true, createdAt: now, updatedAt: now, updatedBy: by });
  return _id;
}

const photosOf = (i: Partial<Pick<QaItemDoc, "productPhotos" | "pricePhotos">>) => [...(i.productPhotos ?? []), ...(i.pricePhotos ?? [])];

/** 刪掉 ll3 上沒有任何問答在用的照片（複製的問答會共用同一張，所以要先查） */
export async function cleanupPhotos(names: string[]) {
  for (const n of new Set(names)) {
    if (await QaItem.exists({ $or: [{ productPhotos: n }, { pricePhotos: n }] })) continue;
    await deletePhoto(n).catch((e) => console.error("deletePhoto", n, e));
  }
}

export async function setActive(id: string, active: boolean, by: string) {
  await connectDB();
  const r = await QaItem.updateOne({ _id: id }, { $set: { active, updatedAt: new Date(), updatedBy: by } });
  if (!r.matchedCount) throw new QaError("找不到這則問答");
}

export async function deleteItem(id: string) {
  await connectDB();
  const old = await QaItem.findOneAndDelete({ _id: id }).lean<QaItemDoc>();
  if (!old) throw new QaError("找不到這則問答");
  await cleanupPhotos(photosOf(old));
}

/** 分類：整份清單照順序送來；沒有 id 的是新增，原本有、清單裡沒有的是刪除（裡面還有問答就不能刪） */
export async function saveCategories(list: unknown) {
  if (!Array.isArray(list) || !list.length) throw new QaError("至少要有一個分類");
  if (list.length > 30) throw new QaError("分類最多 30 個");
  const rows = list.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return { id: s(o.id, 40), name: s(o.name, 20) };
  });
  if (rows.some((r) => !r.name)) throw new QaError("分類名稱不能空白");
  const names = rows.map((r) => r.name);
  if (new Set(names).size !== names.length) throw new QaError("分類名稱不能重複");

  const cats = await sortedCats();
  const existing = new Set(cats.map((c) => c._id));
  if (rows.some((r) => r.id && !existing.has(r.id))) throw new QaError("分類已被別人修改，請重新整理頁面");
  const keep = new Set(rows.map((r) => r.id).filter(Boolean));
  const removed = cats.filter((c) => !keep.has(c._id));
  for (const c of removed) {
    const n = await QaItem.countDocuments({ cat: c._id });
    if (n) throw new QaError(`「${c.name}」裡還有 ${n} 則問答，先把問答移到其他分類或刪除，才能刪掉這個分類`);
  }
  const now = new Date();
  await QaCategory.bulkWrite([
    ...removed.map((c) => ({ deleteOne: { filter: { _id: c._id } } })),
    ...rows.map((r, sort) =>
      r.id
        ? { updateOne: { filter: { _id: r.id }, update: { $set: { name: r.name, sort } } } }
        : { insertOne: { document: { _id: newId(), name: r.name, sort, createdAt: now } } },
    ),
  ]);
}

/** 答不出來的問題加入問答後：記下對應的問答，並把這則提醒標成處理完 */
export async function linkAlert(alertId: string, qaId: string, by: string) {
  await connectDB();
  const log = await AlertLog.findOneAndUpdate(
    { _id: alertId, kind: "unanswered" },
    { $set: { qaId, qaAt: new Date() } },
    { returnDocument: "after" },
  ).lean();
  if (!log) throw new QaError("找不到這則答不出來的問題");
  if (!log.resolvedAt) await AlertLog.updateOne({ _id: alertId }, { $set: { resolvedAt: new Date(), how: "resolve", by } });
  // 這位客人沒有其他還沒處理的提醒，就把客戶列表上的提醒拿掉
  const open = await AlertLog.exists({ userId: log.userId, resolvedAt: null });
  if (!open) await LineUser.updateOne({ _id: log.userId, "alert.kind": "unanswered" }, { $set: { alert: null } });
  return log;
}
