import { connectDB } from "./mongodb";
import { LineUser, NotifyLog } from "./models";
import { logMessage } from "./progress";
import { imageMsg, push } from "./line";
import { shippedCard } from "./flex";
import { getOrder, markNotified, SYS_INFO, type Sys } from "./ll3";
import { imgSig } from "./sign";

export class NotifyError extends Error {}

const baseUrl = () => (process.env.BOT_BASE_URL || "").replace(/\/$/, "");
const waybillImg = (sys: Sys, obt: string) => `${baseUrl()}/api/img/waybill?sys=${sys}&obt=${obt}&s=${imgSig("waybill", sys, obt)}`;

/** 9. 後台「LINE 通知客人寄出」：寄出卡＋託運單照片（最多 4 張） */
export async function notifyShipped(sys: Sys, orderId: number) {
  await connectDB();
  const o = await getOrder(sys, orderId);
  const uid = o.line?.uid;
  if (!uid) throw new NotifyError("這筆訂單不是從 LINE 機器人下單，沒有對應的 LINE 客人");
  if (!o.waybills.length) throw new NotifyError("這筆訂單還沒有託運單");

  const imgs = o.waybills.filter((w) => w.jpg).slice(0, 4);
  const obts = o.waybills.map((w) => w.obt);
  try {
    await push(uid, [shippedCard(sys, o, imgs.length > 0), ...imgs.map((w) => imageMsg(waybillImg(sys, w.obt)))]);
  } catch (e) {
    await NotifyLog.create({ sys, orderId, userId: uid, obts, images: 0, ok: false, error: String(e) });
    throw new NotifyError(`LINE 傳送失敗：${e instanceof Error ? e.message : e}`);
  }
  await NotifyLog.create({ sys, orderId, userId: uid, obts, images: imgs.length, ok: true });
  await logMessage(uid, "model", `[寄出通知：${SYS_INFO[sys].label} No.${orderId} 已寄出，託運單號 ${obts.join("、")}]`);
  // 客人還在「已下單」才改成已寄出（已經開始問下一筆的不動）
  await LineUser.updateOne({ _id: uid, stage: "ordered" }, { $set: { stage: "shipped", stageAt: new Date() } });
  await markNotified(sys, orderId, obts).catch((e) => console.error("markNotified", e));
  return { waybills: obts.length, images: imgs.length };
}
