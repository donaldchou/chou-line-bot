import { connectDB } from "./mongodb";
import { AdminSetting, ChatMessage, OrderDraft, type Quote } from "./models";

/*
 * 防止惡意訂購（後台「接單設定」可以調整，0＝不限／關閉）：
 * ① 同一個 LINE 帳號 24 小時內最多幾筆訂單
 * ② 大量訂單（盒數或貨到付款金額超過）要農場主人核准才傳確認卡
 * ⑤ 同一人 1 分鐘內訊息太多，機器人暫停回覆（防洗訊息、保護 AI 費用）
 * ③ 禁止下單名單在客戶的 LineUser.orderBlocked
 */

export const DEFAULT_GUARD = { maxPerDay: 5, bigBoxes: 20, bigCod: 10000, msgPerMin: 10 };
export type GuardSettings = typeof DEFAULT_GUARD;
export const GUARD_LIMITS: Record<keyof GuardSettings, number> = { maxPerDay: 100, bigBoxes: 10000, bigCod: 10_000_000, msgPerMin: 100 };

const ID = "orderGuard";

export async function guardSettings(): Promise<GuardSettings> {
  await connectDB();
  const d = (await AdminSetting.findById(ID).lean()) as Partial<GuardSettings> | null;
  const out = { ...DEFAULT_GUARD };
  for (const k of Object.keys(out) as (keyof GuardSettings)[]) if (typeof d?.[k] === "number") out[k] = d[k]!;
  return out;
}

export async function saveGuardSettings(v: GuardSettings) {
  await connectDB();
  await AdminSetting.updateOne({ _id: ID }, { $set: v }, { upsert: true });
  return guardSettings();
}

/** ① 這位客人 24 小時內成立了幾筆訂單 */
export async function ordersLast24h(userId: string) {
  return OrderDraft.countDocuments({ userId, status: "created", orderedAt: { $gte: new Date(Date.now() - 86400_000) } });
}

/** ② 要不要先給農場主人核准；要的話回傳原因 */
export function bigOrderReason(q: Quote, pay: string, s: GuardSettings) {
  const why: string[] = [];
  if (s.bigBoxes && q.boxes > s.bigBoxes) why.push(`${q.boxes} 盒，超過 ${s.bigBoxes} 盒`);
  if (s.bigCod && pay === "cod" && q.total > s.bigCod) why.push(`貨到付款 ${q.total.toLocaleString("zh-TW")} 元，超過 ${s.bigCod.toLocaleString("zh-TW")} 元`);
  return why.join("、");
}

/** ⑤ 這位客人 1 分鐘內傳了幾則訊息（含剛收到的這則） */
export async function messagesLastMinute(userId: string) {
  return ChatMessage.countDocuments({ userId, role: "user", at: { $gte: new Date(Date.now() - 60_000) } });
}
