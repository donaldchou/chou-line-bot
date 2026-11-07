import { connectDB } from "./mongodb";
import { AlertLog, LineUser, OrderDraft, type LineUserDoc, type OrderDraftDoc } from "./models";
import { push, textMsg } from "./line";
import { confirmCard, productCarousel } from "./flex";
import { getProducts, isSys, SYS_INFO } from "./ll3";
import { logMessage } from "./progress";
import { productImg } from "./bot";

/* 後台對單一客戶的動作 */

const PAUSE_H = 12;
const pauseUntil = () => new Date(Date.now() + PAUSE_H * 3600_000);

export class ActionError extends Error {}

/** 「需要你處理」標成處理完（紀錄留著算處理時間） */
const closeAlerts = (userId: string, how: "reply" | "resolve", by?: string) =>
  AlertLog.updateMany({ userId, resolvedAt: null }, { $set: { resolvedAt: new Date(), how, by } });

export async function customerAction(id: string, body: Record<string, unknown>, by?: string) {
  await connectDB();
  const u = await LineUser.findById(id).lean<LineUserDoc>();
  if (!u) throw new ActionError("找不到這位客戶");
  const act = String(body.action ?? "");

  switch (act) {
    case "reply": {
      const text = String(body.text ?? "").trim();
      if (!text) throw new ActionError("請輸入訊息");
      if (text.length > 2000) throw new ActionError("訊息太長（最多 2000 字）");
      if (u.blocked) throw new ActionError("客人已封鎖官方帳號，傳不出去");
      await push(id, [textMsg(text)]);
      await logMessage(id, "model", text, "admin");
      // 真人回覆後機器人先暫停，避免兩邊搶著回；12 小時後自動恢復
      await LineUser.updateOne({ _id: id }, { $set: { alert: null, botPausedUntil: pauseUntil() } });
      await closeAlerts(id, "reply", by);
      return { ok: true };
    }
    case "products": {
      const sys = body.sys;
      if (!isSys(sys)) throw new ActionError("請選甜柿或水蜜桃");
      if (u.blocked) throw new ActionError("客人已封鎖官方帳號，傳不出去");
      const r = await getProducts(sys);
      if (!r.products.length) throw new ActionError("沒有商品資料");
      await push(id, [productCarousel(sys, r.products.map((p) => ({ p, img: productImg(sys, p.picture) })))]);
      await logMessage(id, "model", `[農場傳了${SYS_INFO[sys].label}產品卡片：${r.products.map((p) => `${p.name} ${p.price}元`).join("、")}]`, "admin");
      return { ok: true };
    }
    case "pause": {
      const on = body.on === true;
      await LineUser.updateOne({ _id: id }, { $set: { botPausedUntil: on ? pauseUntil() : null } });
      return { ok: true };
    }
    case "stopFollow":
      await LineUser.updateOne({ _id: id }, { $set: { followups: 2 } });
      return { ok: true };
    case "markLost":
      await LineUser.updateOne({ _id: id }, { $set: { stage: "lost", stageAt: new Date(), followups: 2 } });
      await OrderDraft.updateMany({ userId: id, status: "pending" }, { $set: { status: "cancelled" } });
      return { ok: true };
    case "memo":
      await LineUser.updateOne({ _id: id }, { $set: { memo: String(body.text ?? "").slice(0, 2000) } });
      return { ok: true };
    case "resolve":
      await LineUser.updateOne({ _id: id }, { $set: { alert: null } });
      await closeAlerts(id, "resolve", by);
      return { ok: true };
    case "remind": {
      if (u.blocked) throw new ActionError("客人已封鎖官方帳號，傳不出去");
      const d = await OrderDraft.findOne({ userId: id, status: "pending", createdAt: { $gte: new Date(Date.now() - 3 * 86400_000) } })
        .sort({ createdAt: -1 })
        .lean<OrderDraftDoc>();
      if (!d) throw new ActionError("這位客人沒有等待確認的訂單（確認卡超過 3 天會失效）");
      const text = `您好，您的${SYS_INFO[d.sys].label}訂單還差最後一步喔！確認卡在下面，核對沒問題按「確認下單」就完成了；要修改也可以直接告訴我們。`;
      await push(id, [textMsg(text), confirmCard(d)]);
      await logMessage(id, "model", `${text}\n[農場重新傳了確認卡]`, "admin");
      return { ok: true };
    }
    default:
      throw new ActionError("不支援的動作");
  }
}
