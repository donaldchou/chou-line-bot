import { connectDB } from "./mongodb";
import { LineUser, OrderDraft } from "./models";
import { botPaused, logMessage } from "./progress";
import { push, textMsg, withQuickReply } from "./line";
import { confirmCard } from "./flex";
import { SYS_INFO } from "./ll3";

const GAP_MS = 6 * 3600_000;
const MAX = 2;

/** 只在台灣時間 09:00～21:00 傳，避免半夜打擾 */
function inQuietHours(now: Date) {
  const h = Number(now.toLocaleString("en-US", { timeZone: "Asia/Taipei", hour: "numeric", hourCycle: "h23" }));
  return h < 9 || h >= 21;
}

/**
 * 客人詢問商品後沒有下單：每 6 小時關心一次，最多 2 次（排程每小時呼叫一次）。
 * 6 小時從「詢問、上次關心、客人最後一則訊息」中最晚的時間算起。
 */
export async function runFollowups(now = new Date()) {
  await connectDB();
  if (inQuietHours(now)) return { skipped: "quiet-hours", sent: 0 };
  const cutoff = new Date(now.getTime() - GAP_MS);
  const users = await LineUser.find({
    blocked: false,
    followups: { $lt: MAX },
    "interest.at": { $lte: cutoff },
    $and: [
      { $or: [{ lastFollowupAt: null }, { lastFollowupAt: { $lte: cutoff } }] },
      { $or: [{ lastMessageAt: null }, { lastMessageAt: { $lte: cutoff } }] },
    ],
  })
    .limit(50)
    .lean();

  let sent = 0;
  const errors: string[] = [];
  for (const u of users) {
    if (!u.interest) continue;
    if (u.lastOrderAt && u.lastOrderAt > u.interest.at) continue;
    // 農場真人接手中就不自動關心
    if (botPaused(u, now)) continue;
    const label = SYS_INFO[u.interest.sys]?.label ?? "水果";
    const n = u.followups + 1;
    const draft = await OrderDraft.findOne({ userId: u._id, status: "pending" }).sort({ createdAt: -1 }).lean();
    const text =
      n === 1
        ? draft
          ? `您好，您的${label}訂單還差最後一步「確認下單」喔！想問一下是不是有遇到什麼問題呢？\n\n確認卡在下面，核對沒問題按「確認下單」就完成了；要修改也可以直接告訴我。`
          : `您好，之前看您在詢問${label}，想問一下下單時有沒有遇到什麼問題呢？\n\n有任何疑問都可以直接問我，或是告訴我要幾盒，我幫您完成訂單。`
        : `您好～${label}正值產季，數量有限。若還需要的話，隨時傳訊息給我就可以囉，不打擾您了！`;
    const quick = [{ label: "繼續下單" }, { label: "我有問題想問" }, { label: "先不用了", data: "nofollow" }];
    const msgs = n === 1 && draft ? [textMsg(text), withQuickReply(confirmCard(draft), quick)] : [withQuickReply(textMsg(text), quick)];
    try {
      await push(u._id, msgs);
      await LineUser.updateOne({ _id: u._id }, { $set: { followups: n, lastFollowupAt: now } });
      await LineUser.updateOne({ _id: u._id, cycle: { $type: "object" } }, { $set: { "cycle.followed": true } });
      await logMessage(u._id, "model", `${text}\n[第 ${n} 次主動關心]`);
      sent++;
    } catch (e) {
      errors.push(`${u._id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { checked: users.length, sent, errors };
}
