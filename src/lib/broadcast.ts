import { randomUUID } from "node:crypto";
import { connectDB } from "./mongodb";
import { Broadcast, ChatMessage, LineUser, OrderDraft, type BroadcastDoc } from "./models";
import { multicast, push, quota, textMsg, withQuickReply, type LineMessage } from "./line";
import { getProducts, isSys, SYS_INFO, type Sys } from "./ll3";
import { productCarousel } from "./flex";
import { productImg } from "./bot";
import { BROADCAST_GAP_DAYS, segmentMembers, segmentSizes } from "./admin-data";
import { previewText } from "./progress";
import { isSegKey } from "./segments";

/* 群發訊息：選分群 → 文字＋產品卡片 → 馬上傳或排定時間（09:00～21:00） */

export class BroadcastError extends Error {}

const H = 3600_000;
const TZ = 8 * H;
const twHour = (d: Date) => new Date(d.getTime() + TZ).getUTCHours();
/** 只在 09:00～21:00 傳 */
export const inWindow = (d: Date) => twHour(d) >= 9 && twHour(d) < 21;

export interface BroadcastInput {
  segs: string[];
  text: string;
  cards: Sys[];
  orderButton: boolean;
}

export function parseInput(body: Record<string, unknown>): BroadcastInput {
  const segs = (Array.isArray(body.segs) ? body.segs : []).map(String).filter((s) => s === "all" || isSegKey(s));
  const text = String(body.text ?? "").trim();
  const cards = (Array.isArray(body.cards) ? body.cards : []).filter(isSys);
  if (!text) throw new BroadcastError("請輸入訊息文字");
  if (text.length > 1000) throw new BroadcastError("訊息太長（最多 1000 字）");
  return { segs: [...new Set(segs)], text, cards: [...new Set(cards)], orderButton: body.orderButton === true };
}

/** 一次群發的訊息：文字、產品卡片；「我要訂購」快速回覆按鈕放在最後一則 */
async function buildMessages(b: BroadcastInput): Promise<LineMessage[]> {
  const msgs: LineMessage[] = [textMsg(b.text)];
  for (const sys of b.cards) {
    const r = await getProducts(sys);
    if (r.products.length) msgs.push(productCarousel(sys, r.products.map((p) => ({ p, img: productImg(sys, p.picture) }))));
  }
  if (b.orderButton) {
    const last = msgs.length - 1;
    msgs[last] = withQuickReply(msgs[last], [{ label: "我要訂購" }, { label: "看產品照片" }]);
  }
  return msgs.slice(0, 5);
}

/** 存進對話紀錄，機器人之後回覆時知道傳過什麼 */
const logText = (b: BroadcastInput) =>
  `${b.text}${b.cards.length ? `\n[農場群發訊息，附上${b.cards.map((s) => SYS_INFO[s].label).join("、")}產品卡片]` : "\n[農場群發訊息]"}`;

export async function createBroadcast(input: BroadcastInput, when: Date | "now", by: string) {
  await connectDB();
  if (!input.segs.length) throw new BroadcastError("請選要傳給哪些分群");
  const at = when === "now" ? new Date() : when;
  if (!inWindow(at)) throw new BroadcastError("只能在 09:00～21:00 傳送");
  if (when !== "now" && at.getTime() < Date.now() - 60_000) throw new BroadcastError("排定時間已經過了");
  const doc = await Broadcast.create({ _id: randomUUID().replace(/-/g, ""), ...input, scheduledAt: at, createdBy: by });
  if (when === "now") return sendBroadcast(doc._id);
  return doc.toObject();
}

/** 真的傳出去：對象在送出時才決定（分群會變） */
export async function sendBroadcast(id: string) {
  await connectDB();
  const b = await Broadcast.findOneAndUpdate({ _id: id, status: "scheduled" }, { $set: { status: "sending" } }, { returnDocument: "after" }).lean<BroadcastDoc>();
  if (!b) throw new BroadcastError("這筆群發已經傳過或取消了");
  const input: BroadcastInput = { segs: b.segs, text: b.text, cards: b.cards.filter(isSys), orderButton: b.orderButton };
  try {
    const { ids } = await segmentMembers(b.segs);
    const msgs = await buildMessages(input);
    let sent = 0;
    let failed = 0;
    const done: string[] = [];
    let lastErr = "";
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      try {
        await multicast(chunk, msgs, randomUUID());
        sent += chunk.length;
        done.push(...chunk);
      } catch (e) {
        failed += chunk.length;
        lastErr = e instanceof Error ? e.message : String(e);
        console.error("multicast", e);
      }
    }
    const now = new Date();
    if (done.length) {
      const text = logText(input);
      await ChatMessage.insertMany(done.map((userId) => ({ userId, role: "model", text, by: "admin", at: now })));
      await LineUser.updateMany({ _id: { $in: done } }, { $set: { lastBroadcastAt: now, lastText: previewText(text), lastRole: "model", lastAt: now } });
    }
    const status = ids.length && !sent ? "failed" : "sent";
    await Broadcast.updateOne({ _id: id }, { $set: { status, sentAt: now, userIds: done, sent, failed, ...(lastErr ? { error: lastErr.slice(0, 300) } : {}) } });
    return { ...b, status, sentAt: now, sent, failed, error: lastErr || undefined };
  } catch (e) {
    await Broadcast.updateOne({ _id: id }, { $set: { status: "failed", error: String(e).slice(0, 300) } });
    throw e;
  }
}

/** 排程：cron 呼叫，到時間的就傳（不在 09:00～21:00 就等到明天早上） */
export async function runDueBroadcasts(now = new Date()) {
  await connectDB();
  if (!inWindow(now)) return { sent: 0 };
  const due = await Broadcast.find({ status: "scheduled", scheduledAt: { $lte: now } }, { _id: 1 }).lean();
  let n = 0;
  for (const d of due) {
    try {
      await sendBroadcast(d._id);
      n++;
    } catch (e) {
      console.error("runDueBroadcasts", e);
    }
  }
  return { sent: n };
}

export async function cancelBroadcast(id: string) {
  await connectDB();
  const r = await Broadcast.updateOne({ _id: id, status: "scheduled" }, { $set: { status: "cancelled" } });
  if (!r.modifiedCount) throw new BroadcastError("只能取消還沒傳出的群發");
}

/** 先傳給一位客人（通常是自己）看看：不算群發、不記錄 */
export async function testBroadcast(input: BroadcastInput, userId: string) {
  await connectDB();
  const u = await LineUser.findById(userId, { blocked: 1 }).lean();
  if (!u) throw new BroadcastError("找不到這位 LINE 好友");
  if (u.blocked) throw new BroadcastError("這位好友已封鎖官方帳號");
  await push(userId, await buildMessages(input));
}

/** 群發頁：各分群人數、本月額度、紀錄（含 7 天內回覆／下單） */
export async function broadcastPage(now = new Date()) {
  await connectDB();
  const [sizes, q, list] = await Promise.all([segmentSizes(now), quota(), Broadcast.find().sort({ scheduledAt: -1 }).limit(30).lean<BroadcastDoc[]>()]);
  const history = await Promise.all(
    list.map(async (b) => {
      let replied: number | null = null;
      let ordered: number | null = null;
      let boxes: number | null = null;
      if (b.status === "sent" && b.sentAt && b.userIds.length) {
        const end = new Date(new Date(b.sentAt).getTime() + 7 * 86400_000);
        const [r, o] = await Promise.all([
          ChatMessage.distinct("userId", { userId: { $in: b.userIds }, role: "user", at: { $gt: b.sentAt, $lte: end } }),
          OrderDraft.find({ userId: { $in: b.userIds }, status: "created", orderedAt: { $gt: b.sentAt, $lte: end } }, { userId: 1, "quote.boxes": 1 }).lean<{ userId: string; quote?: { boxes: number } }[]>(),
        ]);
        replied = r.length;
        ordered = new Set(o.map((x) => x.userId)).size;
        boxes = o.reduce((s, x) => s + (x.quote?.boxes ?? 0), 0);
      }
      return {
        id: b._id,
        segs: b.segs,
        text: b.text,
        cards: b.cards,
        status: b.status,
        scheduledAt: new Date(b.scheduledAt).toISOString(),
        sentAt: b.sentAt ? new Date(b.sentAt).toISOString() : null,
        sent: b.sent,
        failed: b.failed,
        error: b.error ?? "",
        createdBy: b.createdBy,
        replied,
        ordered,
        boxes,
      };
    }),
  );
  return { sizes, quota: q, gapDays: BROADCAST_GAP_DAYS, history };
}

export type BroadcastPageData = Awaited<ReturnType<typeof broadcastPage>>;
