import { connectDB } from "./mongodb";
import { AlertLog, LineUser, type LineUserDoc } from "./models";
import { chat, type ToolHandler } from "./gemini";
import { TOOLS } from "./bot";
import { systemPrompt } from "./knowledge";
import { getProducts, isSys, SYS_INFO } from "./ll3";
import { push, textMsg } from "./line";
import { logMessage } from "./progress";
import { QaError, qaPromptText } from "./qa";

/* 問答管理的「先試問機器人」與「存檔後回覆客人」：用 Gemini 產生回覆，但不寫任何客戶資料 */

const PREVIEW_TOOLS = ["get_products", "flag_customer", "set_quick_replies"];

/** 補答案後主動回覆客人時，給 AI 的說明 */
const followupAsk = (question: string) =>
  `（系統：客人之前問過「${question}」，當時沒有回答到。現在農場補上答案了，請直接回覆這個問題，開頭簡短說聲讓您久等了。不要再呼叫 flag_customer。）`;

/**
 * 用指定的問答內容回答一個問題。
 * followup＝要主動回覆之前沒答到的客人（語氣會先道聲久等）。
 */
export async function previewAnswer(question: string, faq: string, opts: { name?: string; followup?: boolean } = {}) {
  const notes: string[] = [];
  const handlers: Record<string, ToolHandler> = {
    async get_products(a) {
      if (!isSys(a.product)) return { error: "product 要是 kaki 或 peach" };
      const r = await getProducts(a.product);
      return {
        product: SYS_INFO[a.product].label,
        open: r.open,
        closedMessage: r.open ? undefined : r.closedMsg,
        products: r.products.map((p) => ({ id: p.id, name: p.name, price: p.price })),
      };
    },
    async flag_customer(a) {
      if (a.status === "human") notes.push("機器人會同時通知你（需要真人跟進）");
      if (a.status === "unanswered") notes.push("機器人還是答不出來，會通知你");
      return { ok: true };
    },
    async set_quick_replies() {
      return { ok: true };
    },
  };
  const text = await chat(
    systemPrompt(new Date(), opts.name ?? "", faq),
    [{ role: "user", parts: [{ text: opts.followup ? followupAsk(question) : question }] }],
    TOOLS.filter((t) => PREVIEW_TOOLS.includes(t.name)),
    handlers,
  );
  return { text, notes };
}

/** 加入問答後，用新的問答回覆當初問這題的客人（text：試問時看過的那段；沒有就重新產生） */
export async function replyCustomer(alertId: string, text?: string) {
  await connectDB();
  const log = await AlertLog.findById(alertId).lean();
  if (!log) throw new QaError("找不到這則答不出來的問題");
  const u = await LineUser.findById(log.userId).lean<LineUserDoc>();
  if (!u) throw new QaError("找不到這位客戶");
  if (u.blocked) throw new QaError("客人已封鎖官方帳號，傳不出去");
  let msg = (text ?? "").trim().slice(0, 2000);
  if (!msg) {
    const r = await previewAnswer(log.question || log.text, await qaPromptText(), { name: u.displayName, followup: true });
    msg = r.text;
  }
  if (!msg) throw new QaError("機器人沒有產生回覆，請到對話頁手動回覆");
  await push(u._id, [textMsg(msg)]);
  await logMessage(u._id, "model", msg, "admin");
  return msg;
}
