import { connectDB } from "./mongodb";
import { AlertLog, LineUser, QaItem, type LineUserDoc, type QaItemDoc } from "./models";
import { chat, type ToolHandler } from "./gemini";
import { qaPhotoMessages, TOOLS } from "./bot";
import { systemPrompt } from "./knowledge";
import { getProducts, isSys, SYS_INFO } from "./ll3";
import { push, textMsg, type LineMessage } from "./line";
import { logMessage } from "./progress";
import { DRAFT_ID, photoSummary, QaError, qaPromptText, sendsPhotos, type QaDraft } from "./qa";

/* 問答管理的「先試問機器人」與「存檔後回覆客人」：用 Gemini 產生回覆，但不寫任何客戶資料 */

const PREVIEW_TOOLS = ["get_products", "flag_customer", "set_quick_replies", "send_qa_photos"];

/** 試問結果裡機器人會傳的照片 */
export type PreviewPhotos = Pick<QaDraft, "productPhotos" | "pricePhotos" | "sendMode">;

/** 照片和文字依問答設定排好順序 */
function arrange(text: string, item: PreviewPhotos | null): LineMessage[] {
  const t = text ? [textMsg(text)] : [];
  if (!item || !sendsPhotos(item)) return t;
  const p = qaPhotoMessages(item);
  return item.sendMode === "photo" || item.sendMode === "photo_text" ? [...p, ...t] : [...t, ...p];
}

/** 補答案後主動回覆客人時，給 AI 的說明 */
const followupAsk = (question: string) =>
  `（系統：客人之前問過「${question}」，當時沒有回答到。現在農場補上答案了，請直接回覆這個問題，開頭簡短說聲讓您久等了。不要再呼叫 flag_customer。）`;

/**
 * 用指定的問答內容回答一個問題。
 * followup＝要主動回覆之前沒答到的客人（語氣會先道聲久等）。
 */
export async function previewAnswer(question: string, faq: string, opts: { name?: string; followup?: boolean; draft?: QaDraft } = {}) {
  const notes: string[] = [];
  let photos: PreviewPhotos | null = null;
  const handlers: Record<string, ToolHandler> = {
    async send_qa_photos(a) {
      const id = String(a.qa_id ?? "");
      const i: PreviewPhotos | null =
        id === DRAFT_ID && opts.draft ? opts.draft : await QaItem.findOne({ _id: id, active: true }).lean<QaItemDoc>();
      if (!i || !sendsPhotos(i)) return { error: "這題沒有照片" };
      photos = { productPhotos: i.productPhotos ?? [], pricePhotos: i.pricePhotos ?? [], sendMode: i.sendMode };
      return { ok: true, note: i.sendMode === "photo" ? "照片已傳，這題不要再打字回答" : "照片會跟你的回答一起傳給客人" };
    },
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
  return { text, notes, photos: photos as PreviewPhotos | null };
}

/** 加入問答後，用新的問答回覆當初問這題的客人（text：試問時看過的那段；沒有就重新產生） */
export async function replyCustomer(alertId: string, text?: string) {
  await connectDB();
  const log = await AlertLog.findById(alertId).lean();
  if (!log) throw new QaError("找不到這則答不出來的問題");
  const u = await LineUser.findById(log.userId).lean<LineUserDoc>();
  if (!u) throw new QaError("找不到這位客戶");
  if (u.blocked) throw new QaError("客人已封鎖官方帳號，傳不出去");
  // 剛加入的那則問答：有照片就照設定的順序一起傳
  const item = log.qaId ? await QaItem.findById(log.qaId).lean<QaItemDoc>() : null;
  const photos = item && sendsPhotos(item) ? item : null;
  let msg = (text ?? "").trim().slice(0, 2000);
  if (!msg && photos?.sendMode !== "photo") {
    const r = await previewAnswer(log.question || log.text, await qaPromptText(), { name: u.displayName, followup: true });
    msg = r.text;
  }
  if (photos?.sendMode === "photo") msg = "";
  if (!msg && !photos) throw new QaError("機器人沒有產生回覆，請到對話頁手動回覆");
  await push(u._id, arrange(msg, photos));
  const note = photos ? `[已傳送照片：${photoSummary(photos)}（問答：${photos.q}）]` : "";
  await logMessage(u._id, "model", [msg, note].filter(Boolean).join("\n"), "admin");
  return msg || "（照片）";
}
