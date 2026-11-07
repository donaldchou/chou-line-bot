import { connectDB } from "./mongodb";
import { AdminSetting, OrderDraft, ProductSetting } from "./models";
import { getProducts, SYS_INFO, SYSTEMS, type Product, type Sys } from "./ll3";

/* 接單設定：每個品項 接單中／本週額滿／停止接單，加上每週上限盒數（只算 LINE 訂單） */

export type CapStatus = "open" | "full" | "stop";
export const CAP_LABEL: Record<CapStatus, string> = { open: "接單中", full: "本週額滿", stop: "停止接單" };

export const DEFAULT_REPLIES = {
  full: "不好意思，這個規格這週的出貨已經排滿了，下週一會再開放訂購，也可以先看看其他規格喔！",
  stop: "這個規格目前已經停止接單了，謝謝您的支持！",
};
export type CapReplies = typeof DEFAULT_REPLIES;

const H = 3600_000;
const TZ = 8 * H;
/** 台灣時間本週一 00:00 */
export function weekStart(now = new Date()) {
  const day = Math.floor((now.getTime() + TZ) / 86400_000) * 86400_000 - TZ;
  const dow = new Date(now.getTime() + TZ).getUTCDay();
  return new Date(day - ((dow + 6) % 7) * 86400_000);
}

const REPLY_ID = "capacityReplies";
export async function capReplies(): Promise<CapReplies> {
  await connectDB();
  const d = (await AdminSetting.findById(REPLY_ID).lean()) as Partial<CapReplies> | null;
  return { full: d?.full || DEFAULT_REPLIES.full, stop: d?.stop || DEFAULT_REPLIES.stop };
}
export async function saveCapReplies(r: CapReplies) {
  await connectDB();
  await AdminSetting.updateOne({ _id: REPLY_ID }, { $set: { full: r.full, stop: r.stop } }, { upsert: true });
  return capReplies();
}

/** 本週 LINE 訂單各品項的盒數 */
async function weekSold(sys: Sys, now = new Date()) {
  const rows = await OrderDraft.aggregate<{ _id: string; n: number }>([
    { $match: { sys, status: "created", orderedAt: { $gte: weekStart(now) } } },
    { $unwind: "$quote.lines" },
    { $group: { _id: "$quote.lines.id", n: { $sum: "$quote.lines.qty" } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

export interface ProductCap {
  id: string;
  name: string;
  price: number;
  /** 手動設定 */
  status: CapStatus;
  cap: number | null;
  sold: number;
  /** 實際狀態：上限到了會自動變成本週額滿 */
  effective: CapStatus;
  /** 還能訂幾盒（null＝不限） */
  left: number | null;
}

/** 某個系統所有品項的接單狀態 */
export async function productCaps(sys: Sys, products?: Product[], now = new Date()): Promise<ProductCap[]> {
  await connectDB();
  const list = products ?? (await getProducts(sys)).products;
  const [settings, sold] = await Promise.all([ProductSetting.find({ sys }).lean(), weekSold(sys, now)]);
  const byId = new Map(settings.map((s) => [s.productId, s]));
  return list.map((p) => {
    const s = byId.get(p.id);
    const status = (s?.status ?? "open") as CapStatus;
    const cap = s?.cap ?? null;
    const n = sold.get(p.id) ?? 0;
    const left = cap === null ? null : Math.max(0, cap - n);
    const effective: CapStatus = status !== "open" ? status : left === 0 ? "full" : "open";
    return { id: p.id, name: p.name, price: p.price, status, cap, sold: n, effective, left };
  });
}

/**
 * 下單前檢查：每個品項要「接單中」，數量不能超過本週剩下的盒數。
 * 不行時回傳要跟客人說的話。
 */
export async function checkCapacity(sys: Sys, items: { id: string; qty: number }[], now = new Date()) {
  const [caps, replies] = await Promise.all([productCaps(sys, undefined, now), capReplies()]);
  const byId = new Map(caps.map((c) => [c.id, c]));
  for (const it of items) {
    const c = byId.get(it.id);
    if (!c) continue; // 貨號不對由 ll3 報價時處理
    if (c.effective !== "open") return { ok: false as const, product: c.name, status: c.effective, reply: replies[c.effective as "full" | "stop"] };
    if (c.left !== null && it.qty > c.left) {
      return {
        ok: false as const,
        product: c.name,
        status: "full" as CapStatus,
        reply: `不好意思，${c.name}這週只剩 ${c.left} 盒可以出貨，要改成 ${c.left} 盒，或換其他規格嗎？`,
      };
    }
  }
  return { ok: true as const };
}

/** 後台「接單設定」頁的資料 */
export async function capacityPage(now = new Date()) {
  const replies = await capReplies();
  const systems = await Promise.all(
    SYSTEMS.map(async (sys) => {
      try {
        const r = await getProducts(sys);
        return { sys, label: SYS_INFO[sys].label, open: r.open as boolean | null, error: "", products: await productCaps(sys, r.products, now) };
      } catch (e) {
        return { sys, label: SYS_INFO[sys].label, open: null, error: e instanceof Error ? e.message : String(e), products: [] as ProductCap[] };
      }
    }),
  );
  return { weekStart: weekStart(now).toISOString(), replies, systems };
}

export async function saveProductSetting(sys: Sys, productId: string, patch: { status?: CapStatus; cap?: number | null }, by: string) {
  await connectDB();
  const set: Record<string, unknown> = { sys, productId, updatedAt: new Date(), updatedBy: by };
  if (patch.status) set.status = patch.status;
  if (patch.cap !== undefined) set.cap = patch.cap;
  await ProductSetting.updateOne({ _id: `${sys}:${productId}` }, { $set: set }, { upsert: true });
}

export type CapacityData = Awaited<ReturnType<typeof capacityPage>>;
