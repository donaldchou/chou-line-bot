import { randomUUID } from "node:crypto";
import { connectDB } from "./mongodb";
import {
  AlertLog,
  ChatMessage,
  LineUser,
  OrderDraft,
  QaItem,
  WebhookEvent,
  type LineUserDoc,
  type OrderInput,
  type QaItemDoc,
  type QaSendMode,
} from "./models";
import { botPaused, logMessage, previewText, setStage } from "./progress";
import { getProfile, imageMsg, send, showLoading, textMsg, withQuickReply, type LineMessage, type QuickItem } from "./line";
import type { Content, FunctionDecl, ToolHandler } from "./gemini";
import { chat } from "./ai";
import { systemPrompt, FARM } from "./knowledge";
import {
  createOrder,
  getProducts,
  isSys,
  Ll3Error,
  productPictureUrl,
  queryOrders,
  quote,
  SYS_INFO,
  SYSTEMS,
  type OrderInfo,
  type Sys,
} from "./ll3";
import { confirmCard, deliveryText, orderCarousel, payText, photoAlbum, productCarousel, successCard } from "./flex";
import { imgSig } from "./sign";
import { CAP_LABEL, capReplies, checkCapacity, productCaps } from "./capacity";
import { linksIn, photoSummary, qaPromptText, sendsPhotos } from "./qa";
import { bigOrderReason, guardSettings, messagesLastMinute, ordersLast24h } from "./guard";

const HISTORY = 30;
const DRAFT_DAYS = 3;
const SORRY = `不好意思，系統現在有點忙，請稍後再傳一次訊息，或直接來電 ${FARM.phone}，謝謝您！`;

const baseUrl = () => (process.env.BOT_BASE_URL || "").replace(/\/$/, "");

/** 商品照片經機器人轉成 https（LINE 只收 https 圖片） */
export function productImg(sys: Sys, picture: string) {
  if (!productPictureUrl(sys, picture)) return null;
  const p = encodeURIComponent(picture);
  return `${baseUrl()}/api/img/product?sys=${sys}&p=${p}&s=${imgSig("product", sys, picture)}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type LineEvent = Record<string, any>;

export async function handleEvent(ev: LineEvent) {
  await connectDB();
  // LINE 可能重送同一個事件
  if (ev.webhookEventId) {
    try {
      await WebhookEvent.create({ _id: ev.webhookEventId });
    } catch {
      return;
    }
  }
  const userId: string | undefined = ev.source?.userId;
  if (!userId || ev.source?.type !== "user") return;

  if (ev.type === "unfollow") {
    await LineUser.updateOne({ _id: userId }, { $set: { blocked: true } });
    return;
  }
  const user = await ensureUser(userId, ev.type === "follow");

  try {
    if (ev.type === "follow") return await welcome(user, ev.replyToken);
    if (ev.type === "postback") return await handlePostback(user, String(ev.postback?.data ?? ""), ev.replyToken);
    if (ev.type === "message") {
      const m = ev.message ?? {};
      const text =
        m.type === "text"
          ? String(m.text ?? "")
          : m.type === "sticker"
            ? "（客人傳了一張貼圖）"
            : m.type === "image"
              ? "（客人傳了一張照片）"
              : m.type === "location"
                ? `（客人傳了位置：${m.address ?? ""}）`
                : `（客人傳了${m.type}訊息）`;
      return await handleText(user, text, ev.replyToken);
    }
  } catch (e) {
    console.error("handleEvent", e);
    await send(userId, ev.replyToken, [textMsg(SORRY)]).catch(() => {});
  }
}

async function ensureUser(userId: string, isFollow: boolean) {
  let user = await LineUser.findById(userId).lean<LineUserDoc>();
  if (!user || isFollow) {
    const p = await getProfile(userId);
    user = await LineUser.findOneAndUpdate(
      { _id: userId },
      { $set: { displayName: p?.displayName ?? user?.displayName ?? "", pictureUrl: p?.pictureUrl, blocked: false } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    ).lean<LineUserDoc>();
  }
  return user!;
}

const saveMsg = (userId: string, role: "user" | "model", text: string) => logMessage(userId, role, text);

/* ---------- 1. 加好友歡迎 ---------- */
async function welcome(user: LineUserDoc, replyToken: string) {
  const open: string[] = [];
  await Promise.all(
    SYSTEMS.map(async (s) => {
      try {
        if ((await getProducts(s)).open) open.push(SYS_INFO[s].label);
      } catch {
        /* 連不到訂單系統時不顯示 */
      }
    }),
  );
  const text = `您好，歡迎加入${FARM.name}！
我是農場的 AI 小幫手，可以幫您：
・介紹水蜜桃、甜柿
・直接在 LINE 下單
・查詢訂單與出貨進度
${open.length ? `\n現在開放訂購：${open.join("、")}\n` : ""}
有任何問題直接打字問我就可以囉！`;
  const quick: QuickItem[] = [
    ...open.map((l) => ({ label: `我要訂${l}` })),
    { label: "看產品照片" },
    { label: "查訂單" },
    { label: "運費怎麼算" },
  ];
  await send(user._id, replyToken, [withQuickReply(textMsg(text), quick)]);
  await saveMsg(user._id, "model", text);
}

/* ---------- AI 對話 ---------- */

interface Turn {
  user: LineUserDoc;
  /** 客人這次傳的訊息 */
  text: string;
  out: LineMessage[];
  quick: QuickItem[];
  notes: string[];
  /** 這一輪已經通知過農場（flag_customer unanswered／human） */
  flagged: boolean;
  /** 這一輪工具遇到的系統錯誤（訂單系統連不上、試算失敗…） */
  toolErrors: string[];
  /** 問答附的照片（get_qa_answer）：mode 決定跟文字的先後 */
  qaPhotos: { mode: QaSendMode; msgs: LineMessage[]; ids: string[] } | null;
  /** 這一輪用到的問答裡的網址：AI 的回覆漏掉就補在最後 */
  links: string[];
  /** 客人按的選單按鈕剛好是這題的題目：照片每次都傳（不管剛剛傳過沒） */
  forcePhotosFor?: string;
}

/** 回覆漏掉的網址補在最後（例如問答裡的 Google 導航連結） */
export const addMissingLinks = (text: string, links: string[]) => {
  const missing = [...new Set(links)].filter((u) => !text.includes(u));
  return text && missing.length ? `${text}\n${missing.join("\n")}` : text;
};

/** 機器人有時會模仿對話紀錄，自己寫出「[已傳送照片…]」這類系統紀錄：傳給客人前拿掉 */
export const stripNotes = (text: string) =>
  text
    .replace(/^[ \t]*\[(已|訂單|寄出|系統)[^\]\n]*\][ \t]*$/gm, "")
    // 程式用語（open=false、orderStatus: 額滿…）不給客人看，連同前面的「系統顯示」一起拿掉
    .replace(/(系統(資料)?(顯示|回傳|上)?[ \t]*)?[`「（(]?(?<![?&/#=.\w-])(open|status|orderStatus|product|id|leftThisWeek)[ \t]*[=:：][ \t]*[`「]?[\w.\-]+[`」）)]?[ \t]*[，,、]?/gi, "")
    // 值是中文（orderStatus：額滿）→ 只拿掉程式用語，留下「額滿」
    .replace(/(系統(資料)?(顯示|回傳|上)?[ \t]*)?(?<![?&/#=.\w-])(open|status|orderStatus|product|leftThisWeek)[ \t]*[=:：][ \t]*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** 問答照片的網址（LINE 和後台都經機器人讀 ll3） */
export const qaPhotoUrl = (name: string) => `${baseUrl()}/api/qa-photo/${name}`;

/** 一則問答要傳的照片訊息：產品照片、價格照片各一則相簿 */
export function qaPhotoMessages(i: Pick<QaItemDoc, "productPhotos" | "pricePhotos">) {
  return [
    ...(i.productPhotos?.length ? [photoAlbum("產品照片", i.productPhotos.map(qaPhotoUrl))] : []),
    ...(i.pricePhotos?.length ? [photoAlbum("價格照片", i.pricePhotos.map(qaPhotoUrl))] : []),
  ];
}

/**
 * ③ 禁止下單、① 24 小時內筆數上限：不能下單時回傳要跟客人說的話。
 * alert：要通知農場主人的內容（禁止下單名單的客人不另外通知）
 */
async function orderBlockedReply(userId: string): Promise<{ reply: string; alert?: string } | null> {
  const [u, s] = await Promise.all([LineUser.findById(userId, { orderBlocked: 1 }).lean<Pick<LineUserDoc, "orderBlocked">>(), guardSettings()]);
  if (u?.orderBlocked) return { reply: `不好意思，這個帳號目前無法在 LINE 下單，需要訂購請來電 ${FARM.phone}，由專人為您服務。` };
  if (s.maxPerDay) {
    const n = await ordersLast24h(userId);
    if (n >= s.maxPerDay)
      return {
        reply: `不好意思，LINE 上同一個帳號 24 小時內最多下 ${s.maxPerDay} 筆訂單，您已經訂了 ${n} 筆。還需要訂購的話請來電 ${FARM.phone}，謝謝您！`,
        alert: `客人 24 小時內已經訂了 ${n} 筆，達到上限 ${s.maxPerDay} 筆，還想再訂`,
      };
  }
  return null;
}

/** 通知農場：客戶列表亮提醒＋留紀錄（總覽「機器人表現」、問答管理「答不出來的問題」用） */
async function raiseAlert(t: Turn, kind: "unanswered" | "human", text: string) {
  const at = new Date();
  const msg = text.slice(0, 200);
  await LineUser.updateOne({ _id: t.user._id }, { $set: { alert: { kind, text: msg, at } } });
  // question＝客人原話
  await AlertLog.create({ userId: t.user._id, kind, text: msg, question: t.text.slice(0, 500), at });
  t.flagged = true;
  t.notes.push(`[已通知農場主人：${msg}]`);
}

/** 機器人的回覆裡說了「已請老闆處理／會請農場主人回覆」這類話 */
const PROMISED_HUMAN =
  /(已|會|幫您|替您|為您)[^。！？\n]{0,8}(請|通知|轉達|告知|回報)[^。！？\n]{0,6}(老闆|農場主人|農場|真人|專人)|(老闆|農場主人|專人|真人)[^。！？\n]{0,6}(會|將)[^。！？\n]{0,6}(聯絡|聯繫|回覆|處理|協助)/;

export const TOOLS: FunctionDecl[] = [
  {
    name: "get_products",
    description: "查詢甜柿或水蜜桃目前的規格、價格與是否開放訂購。報價或回答能不能訂之前一定要先呼叫。",
    parameters: { type: "object", properties: { product: { type: "string", enum: ["kaki", "peach"], description: "kaki=甜柿, peach=水蜜桃" } }, required: ["product"] },
  },
  {
    name: "send_product_photos",
    description: "傳產品照片卡片給客人（可左右滑動，有「訂這個」按鈕）。",
    parameters: {
      type: "object",
      properties: {
        product: { type: "string", enum: ["kaki", "peach"] },
        product_ids: { type: "array", items: { type: "string" }, description: "只傳這些貨品編號；省略＝全部規格" },
      },
      required: ["product"],
    },
  },
  {
    name: "get_qa_answer",
    description: "取得常見問題的回答，並把那題附的照片傳給客人。常見問題裡註明要呼叫的題目一定要用，qa_id 照抄。",
    parameters: { type: "object", properties: { qa_id: { type: "string" } }, required: ["qa_id"] },
  },
  {
    name: "prepare_order",
    description: "資料齊全後建立待確認的訂單，系統會傳確認卡給客人，客人按「確認下單」才會真的成立。",
    parameters: {
      type: "object",
      properties: {
        product: { type: "string", enum: ["kaki", "peach"] },
        items: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string", description: "貨品編號（get_products 的 id）" }, qty: { type: "integer" } }, required: ["id", "qty"] },
        },
        buyer_name: { type: "string" },
        buyer_sex: { type: "string", enum: ["M", "F"], description: "M=先生 F=小姐，不確定填 M" },
        buyer_phone: { type: "string" },
        buyer_phone2: { type: "string" },
        buyer_email: { type: "string" },
        recipient_same: { type: "boolean", description: "收件者是否同訂購者" },
        recipient_name: { type: "string" },
        recipient_phone: { type: "string" },
        recipient_phone2: { type: "string" },
        address: { type: "string", description: "收件地址（完整）" },
        delivery: { type: "string", enum: ["AM", "FM"], description: "AM=早上08~13 FM=中午13~18" },
        pay: { type: "string", enum: ["cod", "atm", "card"], description: "cod=貨到付款 atm=匯款或ATM轉帳 card=刷卡繳費" },
        memo: { type: "string", description: "客人的其他交代事項（沒有就省略）" },
      },
      required: ["product", "items", "buyer_name", "buyer_phone", "recipient_same", "address", "delivery", "pay"],
    },
  },
  {
    name: "lookup_orders",
    description: "用訂購者姓名或電話查詢訂單，系統會傳訂單卡片給客人。客人有說要查甜柿或水蜜桃（例如剛按了「甜柿訂單」）就填 product，只查那一種；沒說就不填，兩種都查。",
    parameters: {
      type: "object",
      properties: { name: { type: "string" }, phone: { type: "string" }, product: { type: "string", enum: ["kaki", "peach"], description: "kaki＝甜柿、peach＝水蜜桃" } },
    },
  },
  {
    name: "set_quick_replies",
    description: "在你的回覆下方放快速回覆按鈕（最多 6 個，每個 20 字內），例如送達時段、付款方式。",
    parameters: { type: "object", properties: { options: { type: "array", items: { type: "string" } } }, required: ["options"] },
  },
  {
    name: "flag_customer",
    description:
      "更新給農場主人看的客戶狀態（客人看不到）。status=filling：客人開始下單、資料還沒給齊（missing 寫還缺什麼）。status=unanswered：你答不出來或資料裡沒有答案。status=human：客人想找真人、老闆，或是抱怨、退款、商品損傷等需要真人處理的事（reason 簡短說明）。",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["filling", "unanswered", "human"] },
        missing: { type: "string", description: "filling 時：還缺的資料，例如「收件地址、送達時段」" },
        reason: { type: "string", description: "unanswered／human 時：一句話說明，例如「問收到壓傷怎麼處理」" },
      },
      required: ["status"],
    },
  },
];

async function markInterest(user: LineUserDoc, sys: Sys) {
  const now = new Date();
  // 超過 30 天沒問過才重新開始計算關心次數（2 次後不再主動詢問）
  const fresh = !user.interest?.at || now.getTime() - new Date(user.interest.at).getTime() > 30 * 86400_000;
  await LineUser.updateOne(
    { _id: user._id },
    { $set: { interest: { sys, at: now }, ...(fresh ? { followups: 0, lastFollowupAt: null } : {}) } },
  );
  await setStage(user._id, "ask", { sys });
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const asSys = (v: unknown): Sys => {
  if (!isSys(v)) throw new Error("product 要是 kaki 或 peach");
  return v;
};

/** 工具丟出的例外（連不上訂單系統等）記下來，回覆後檢查要不要通知農場 */
function handlers(t: Turn): Record<string, ToolHandler> {
  return Object.fromEntries(
    Object.entries(rawHandlers(t)).map(([name, h]) => [
      name,
      async (a: Record<string, unknown>) => {
        try {
          return await h(a);
        } catch (e) {
          t.toolErrors.push(`${name}：${e instanceof Error ? e.message : String(e)}`);
          throw e;
        }
      },
    ]),
  );
}

function rawHandlers(t: Turn): Record<string, ToolHandler> {
  return {
    async get_products(a) {
      const sys = asSys(a.product);
      const r = await getProducts(sys);
      await markInterest(t.user, sys);
      // 農場在後台「接單設定」可以把個別規格設成本週額滿或停止接單
      const [caps, replies] = await Promise.all([productCaps(sys, r.products), capReplies()]);
      const capOf = new Map(caps.map((c) => [c.id, c]));
      return {
        product: SYS_INFO[sys].label,
        // 用中文狀態，AI 才不會把 open=false 這種程式用語念給客人
        status: r.open ? "開放訂購中" : "目前沒有開放訂購",
        closedMessage: r.open ? undefined : r.closedMsg,
        products: r.products.map((p) => {
          const c = capOf.get(p.id);
          const st = c?.effective ?? "open";
          return {
            id: p.id,
            name: p.name,
            price: p.price,
            orderStatus: CAP_LABEL[st],
            ...(st !== "open" ? { reply: replies[st] } : c?.left != null ? { leftThisWeek: c.left } : {}),
          };
        }),
        note: "orderStatus 不是「接單中」的規格不能下單，照 reply 的意思回覆客人，並推薦其他接單中的規格",
      };
    },

    async send_product_photos(a) {
      const sys = asSys(a.product);
      const ids = Array.isArray(a.product_ids) ? (a.product_ids as unknown[]).map(String) : [];
      const r = await getProducts(sys);
      const list = r.products.filter((p) => !ids.length || ids.includes(p.id));
      if (!list.length) return { error: "沒有這些商品" };
      t.out.push(productCarousel(sys, list.map((p) => ({ p, img: productImg(sys, p.picture) }))));
      t.notes.push(`[已傳送${SYS_INFO[sys].label}產品卡片：${list.map((p) => `${p.name}（貨號 ${p.id}）${p.price}元`).join("、")}]`);
      await markInterest(t.user, sys);
      return { sent: list.length, status: r.open ? "開放訂購中" : "目前沒有開放訂購", closedMessage: r.open ? undefined : r.closedMsg };
    },

    async prepare_order(a) {
      const sys = asSys(a.product);
      const items = (Array.isArray(a.items) ? a.items : [])
        .map((x: any) => ({ id: str(x?.id), qty: Math.floor(Number(x?.qty)) }))
        .filter((x) => x.id && x.qty > 0);
      const data: OrderInput = {
        buyerName: str(a.buyer_name),
        buyerSex: a.buyer_sex === "F" ? "F" : "M",
        buyerPhone: str(a.buyer_phone),
        buyerPhone2: str(a.buyer_phone2) || undefined,
        buyerEmail: str(a.buyer_email) || undefined,
        recipientSame: a.recipient_same !== false,
        recipientName: str(a.recipient_name) || undefined,
        recipientPhone: str(a.recipient_phone) || undefined,
        recipientPhone2: str(a.recipient_phone2) || undefined,
        address: str(a.address),
        delivery: a.delivery === "FM" ? "FM" : "AM",
        pay: a.pay === "atm" || a.pay === "card" ? a.pay : "cod",
        items,
        memo: str(a.memo) || undefined,
      };
      const missing = [
        !data.buyerName && "訂購者姓名",
        !data.buyerPhone && "訂購者電話",
        !data.recipientSame && !data.recipientName && "收件者姓名",
        !data.recipientSame && !data.recipientPhone && "收件者電話",
        !data.address && "收件地址",
        !items.length && "訂購盒數",
      ].filter(Boolean);
      if (missing.length) {
        await setStage(t.user._id, "fill", { sys, missing: missing.join("、") });
        return { error: `還缺：${missing.join("、")}` };
      }
      if (data.recipientSame) {
        data.recipientName = data.recipientPhone = data.recipientPhone2 = undefined;
      }

      // ③ 禁止下單名單、① 24 小時內筆數上限
      const blocked = await orderBlockedReply(t.user._id);
      if (blocked) {
        if (blocked.alert) await raiseAlert(t, "human", blocked.alert);
        return { error: "這位客人現在不能在 LINE 下單", reply: blocked.reply, note: "照 reply 的意思回覆客人，不要再呼叫 prepare_order" };
      }

      const p = await getProducts(sys);
      if (!p.open) return { error: `${SYS_INFO[sys].label}目前沒有開放訂購`, closedMessage: p.closedMsg };
      // AI 有時會自己編貨號（例如 kaki-8）：用數字對回「8粒裝」，對不到就把正確貨號給它重試
      const bad: string[] = [];
      for (const it of items) {
        if (p.products.some((x) => x.id === it.id)) continue;
        const n = it.id.match(/\d+/)?.[0];
        const hit = n ? p.products.filter((x) => x.name.includes(`${Number(n)}粒`)) : [];
        if (hit.length === 1) it.id = hit[0].id;
        else bad.push(it.id);
      }
      if (bad.length) {
        return {
          error: `貨品編號不對：${bad.join("、")}`,
          products: p.products.map((x) => ({ id: x.id, name: x.name })),
          note: "請用上面正確的 id 重新呼叫 prepare_order，不用跟客人提這件事",
        };
      }
      const cap = await checkCapacity(sys, items);
      if (!cap.ok) return { error: `${cap.product}${CAP_LABEL[cap.status]}，不能下單`, reply: cap.reply };
      let q;
      try {
        q = await quote(sys, items, data.pay);
      } catch (e) {
        if (e instanceof Ll3Error) {
          t.toolErrors.push(`試算金額失敗：${e.message}`);
          return { error: e.message, note: "這是訂單系統的問題，不是客人的錯。請呼叫 flag_customer(status=\"human\") 通知農場主人，並請客人稍等或直接來電" };
        }
        throw e;
      }
      // 之前還沒確認的訂單作廢，只留這一張
      await OrderDraft.updateMany({ userId: t.user._id, status: { $in: ["pending", "review"] } }, { $set: { status: "cancelled" } });
      const lines = q.lines.map((l) => `${l.name}x${l.qty}`).join("、");

      // ② 大量訂單：先不傳確認卡，等農場主人在後台核准
      const big = bigOrderReason(q, data.pay, await guardSettings());
      if (big) {
        await OrderDraft.create({ _id: randomUUID().replace(/-/g, ""), userId: t.user._id, sys, data, quote: q, status: "review", review: { reason: big } });
        await raiseAlert(t, "human", `大量訂單等你核准（${big}）：${SYS_INFO[sys].label} ${lines}，${q.total} 元。到對話頁按「核准並傳確認卡」`);
        t.notes.push(`[訂單等農場主人核准，還沒傳確認卡：${SYS_INFO[sys].label} ${lines}，總金額 ${q.total} 元]`);
        await setStage(t.user._id, "confirm", { sys, contact: { name: data.buyerName, phone: data.buyerPhone } });
        return {
          held: true,
          total: q.total,
          note: "這筆訂單數量或金額比較大，要先由農場主人確認。請告訴客人：資料已收到，農場主人確認後會傳確認卡給他，再按確認下單就完成；急的話可以來電。絕對不能說訂單已成立。",
        };
      }

      const draft = await OrderDraft.create({ _id: randomUUID().replace(/-/g, ""), userId: t.user._id, sys, data, quote: q });
      t.out.push(confirmCard(draft.toObject()));
      t.notes.push(`[已傳送確認卡：${SYS_INFO[sys].label} ${lines}，訂購者 ${data.buyerName} ${data.buyerPhone}，收件者 ${data.recipientSame ? "同訂購者" : `${data.recipientName} ${data.recipientPhone}`}，地址 ${data.address}，${deliveryText(data.delivery)}，${payText(data.pay)}，總金額 ${q.total} 元；等客人按確認下單]`);
      await markInterest(t.user, sys);
      await setStage(t.user._id, "confirm", { sys, contact: { name: data.buyerName, phone: data.buyerPhone } });
      return { ok: true, total: q.total, ship: q.ship, codFee: q.cod, boxes: q.boxes, note: "確認卡已傳給客人，請客人核對後按「確認下單」" };
    },

    async lookup_orders(a) {
      const name = str(a.name);
      const phone = str(a.phone);
      if (!name && phone.replace(/\D/g, "").length < 8) return { error: "請客人提供訂購者姓名或完整電話" };
      const { found, errors } = await findOrders(isSys(a.product) ? [a.product] : SYSTEMS, name, phone);
      t.toolErrors.push(...errors);
      if (found.length) t.out.push(orderCarousel(found));
      t.notes.push(`[查詢訂單 ${name} ${phone}：找到 ${found.length} 筆${found.length ? "，已傳送訂單卡片" : ""}]`);
      return {
        count: found.length,
        orders: found.slice(0, 10).map(({ sys, o }) => ({
          product: SYS_INFO[sys].label,
          orderNo: o.id,
          date: o.time,
          status: o.schedule,
          waybills: o.waybills.map((w) => ({ no: w.obt, status: w.status })),
        })),
        errors: errors.length ? errors : undefined,
      };
    },

    async get_qa_answer(a) {
      const i = await QaItem.findOne({ _id: str(a.qa_id), active: true }).lean<QaItemDoc>();
      if (!i) return { error: "沒有這題" };
      const answer = { answer: i.a || "（這題沒有文字回答）", ...(linksIn(i.a).length ? { links: "回答裡的網址要完整附給客人" } : {}) };
      if (i.sendMode !== "photo") t.links.push(...linksIn(i.a));
      if (!sendsPhotos(i)) return answer;
      const skip = (why: string) => ({ ...answer, photos: why });
      // 一則訊息問了兩件事時可以傳兩題的照片；同一題不重複，最多 2 題
      if (t.qaPhotos?.ids.includes(i._id)) return skip("這題的照片已經傳了");
      // 最近幾則已經傳過這題的照片就不再傳（AI 有時會把前面的問題再處理一次）；客人明說要再看一次才重傳
      const recent = await ChatMessage.find({ userId: t.user._id, role: "model" }, { text: 1 }).sort({ at: -1 }).limit(3).lean();
      const again = /再(傳|給|看|發)|重(新)?傳|沒(收到|看到)/.test(t.text);
      if (!again && t.forcePhotosFor !== String(i._id) && recent.some((m) => m.text.includes(`（問答：${i.q}）]`))) return skip("這題的照片剛剛已經傳過，這次不再傳，也不要說又傳了一次");
      if ((t.qaPhotos?.ids.length ?? 0) >= 2) return skip("這一輪已經傳了兩題的照片，這題的照片請客人再問");
      t.qaPhotos = {
        mode: t.qaPhotos?.mode ?? i.sendMode,
        msgs: [...(t.qaPhotos?.msgs ?? []), ...qaPhotoMessages(i)],
        ids: [...(t.qaPhotos?.ids ?? []), i._id],
      };
      t.notes.push(`[已傳送照片：${photoSummary(i)}（問答：${i.q}）]`);
      return i.sendMode === "photo"
        ? { photos: "已傳照片給客人；這題只傳照片，不要再打字回答這題" }
        : { ...answer, photos: `${photoSummary(i)}會${i.sendMode === "photo_text" ? "在你的回覆前面先傳給客人" : "附在你的回覆後面"}，可以簡短提一下有附照片` };
    },

    async set_quick_replies(a) {
      const opts = (Array.isArray(a.options) ? a.options : []).map((x) => String(x).slice(0, 20)).filter(Boolean).slice(0, 6);
      t.quick = opts.map((label) => ({ label }));
      return { ok: true };
    },

    async flag_customer(a) {
      if (a.status === "filling") {
        await setStage(t.user._id, "fill", { sys: t.user.interest?.sys, missing: str(a.missing) });
        return { ok: true };
      }
      if (a.status === "unanswered" || a.status === "human") {
        if (t.flagged) return { ok: true, note: "這一輪已經通知過農場主人了" };
        await raiseAlert(t, a.status, str(a.reason) || (a.status === "human" ? "客人想找真人" : "機器人答不出來"));
        return { ok: true, note: "已通知農場主人，請告訴客人農場會再跟他聯絡，急的話可以直接打電話" };
      }
      return { error: "status 不對" };
    },
  };
}

/** 查 ll3 訂單（指定的系統），最新的在前；某一套連不上時另一套照樣回傳 */
async function findOrders(systems: Sys[], name: string, phone: string) {
  const found: { sys: Sys; o: OrderInfo }[] = [];
  const errors: string[] = [];
  await Promise.all(
    systems.map(async (sys) => {
      try {
        for (const o of await queryOrders(sys, name, phone)) found.push({ sys, o });
      } catch (e) {
        errors.push(`${SYS_INFO[sys].label}訂單系統暫時查不到（${e instanceof Error ? e.message : e}）`);
      }
    }),
  );
  found.sort((x, y) => (y.o.time ?? "").localeCompare(x.o.time ?? ""));
  return { found, errors };
}

/** 客人上次在 LINE 下單留的訂購者電話（「用 0937***993 查詢」按鈕；電話只存在主機，不放在按鈕資料裡） */
async function lastBuyerPhone(userId: string) {
  const d = await OrderDraft.findOne({ userId, status: "created" }).sort({ orderedAt: -1 }).select("data.buyerPhone").lean();
  const p = d?.data?.buyerPhone?.trim() ?? "";
  return p.replace(/\D/g, "").length >= 8 ? p : "";
}

/** 0937521993 → 0937***993 */
export const maskPhone = (p: string) => {
  const d = p.replace(/\D/g, "");
  return d.length >= 8 ? `${d.slice(0, 4)}***${d.slice(-3)}` : "***";
};

/* 圖文選單「查詢訂單」：先選甜柿／水蜜桃，再用上次的電話或客人提供的姓名、電話查 */
export const ORDER_MENU = /^(查詢?|查一下)(我的)?訂單[？?]?$/;
export const ORDER_MENU_QUESTION = "請問要查詢甜柿還是水蜜桃的訂單？";
const sysQuick = (sys: Sys): QuickItem => ({ label: `${SYS_INFO[sys].label}訂單`, data: `lookup:${sys}` });
const otherSys = (sys: Sys): Sys => (sys === "kaki" ? "peach" : "kaki");

async function lookupAsk(user: LineUserDoc, sys: Sys, replyToken: string) {
  const userId = user._id;
  await saveMsg(userId, "user", `${SYS_INFO[sys].label}訂單`);
  const phone = await lastBuyerPhone(userId).catch(() => "");
  const msg = `好的，請告訴我訂購者的姓名或電話（擇一），我幫您查${SYS_INFO[sys].label}的訂單。${phone ? "\n之前在 LINE 下過單的話，也可以直接按下面的按鈕。" : ""}`;
  const quick: QuickItem[] = [
    ...(phone ? [{ label: `用 ${maskPhone(phone)} 查詢`, data: `lookupme:${sys}` }] : []),
    { label: `改查${SYS_INFO[otherSys(sys)].label}`, data: `lookup:${otherSys(sys)}` },
  ];
  await send(userId, replyToken, [withQuickReply(textMsg(msg), quick)]);
  await saveMsg(userId, "model", msg);
}

async function lookupMine(user: LineUserDoc, sys: Sys, replyToken: string) {
  const userId = user._id;
  const label = SYS_INFO[sys].label;
  const phone = await lastBuyerPhone(userId).catch(() => "");
  if (!phone) return lookupAsk(user, sys, replyToken);
  const masked = maskPhone(phone);
  await saveMsg(userId, "user", `用 ${masked} 查詢${label}訂單`);
  void showLoading(userId, 20);
  const { found, errors } = await findOrders([sys], "", phone);
  const again: QuickItem[] = [{ label: `改查${SYS_INFO[otherSys(sys)].label}`, data: `lookup:${otherSys(sys)}` }];
  let msg: string;
  if (found.length) msg = `用 ${masked} 找到 ${found.length} 筆${label}訂單：`;
  else if (errors.length) msg = `${label}訂單系統暫時查不到，請稍後再試一次，不好意思！`;
  else msg = `用 ${masked} 查不到${label}的訂單，可能是用其他電話或姓名下單的，請告訴我訂購者的姓名或電話，我再幫您查。`;
  const msgs: LineMessage[] = [textMsg(msg), ...(found.length ? [orderCarousel(found)] : [])];
  msgs[msgs.length - 1] = withQuickReply(msgs[msgs.length - 1], again);
  await send(userId, replyToken, msgs);
  await saveMsg(userId, "model", `${msg}${found.length ? `\n[查詢訂單 ${masked}：找到 ${found.length} 筆，已傳送訂單卡片]` : ""}`);
}

/** 比對題目用：去掉空白和標點 */
const qaKey = (s: string) => s.replace(/[\s?？!！。，,.、~～]/g, "");

/** 客人的訊息跟某題問答的題目一字不差（例如圖文選單按鈕「我要訂甜柿」）→ 那一題 */
async function exactQa(text: string) {
  const k = qaKey(text);
  if (!k) return null;
  const items = await QaItem.find({ active: true }, { q: 1 }).lean<{ _id: string; q: string }[]>();
  return items.find((i) => qaKey(i.q) === k) ?? null;
}

/** 這位客人最近一筆成功的訂單（給 AI 處理「跟上次一樣」；對話紀錄太舊看不到也找得到） */
async function lastOrderText(userId: string) {
  const d = await OrderDraft.findOne({ userId, status: "created" }).sort({ orderedAt: -1 }).lean();
  if (!d) return "";
  const x = d.data;
  const day = d.orderedAt ? new Date(d.orderedAt).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }) : "";
  return [
    `${day} ${SYS_INFO[d.sys].label}：${d.quote.lines.map((l) => `${l.name}x${l.qty}`).join("、")}`,
    `訂購者 ${x.buyerName}（${x.buyerSex === "F" ? "小姐" : "先生"}）${x.buyerPhone}${x.buyerPhone2 ? `／${x.buyerPhone2}` : ""}${x.buyerEmail ? `，Email ${x.buyerEmail}` : ""}`,
    `收件者 ${x.recipientSame ? "同訂購者" : `${x.recipientName} ${x.recipientPhone}${x.recipientPhone2 ? `／${x.recipientPhone2}` : ""}`}`,
    `地址 ${x.address}`,
    `送達時段 ${x.delivery === "NIGHT" ? "晚上（已停止，要請客人重選）" : deliveryText(x.delivery)}，付款 ${payText(x.pay)}`,
  ].join("\n");
}

async function history(userId: string): Promise<Content[]> {
  const rows = await ChatMessage.find({ userId }).sort({ at: -1 }).limit(HISTORY).lean();
  const list: Content[] = rows.reverse().map((r) => ({ role: r.role, parts: [{ text: r.text }] }));
  while (list.length && list[0].role !== "user") list.shift();
  return list;
}

/** 圖文選單「價格運費」（或客人只打「價格運費」）：先問哪一種水果，不用呼叫 AI */
export const PRICE_MENU = /^(價格|價錢)[和與跟及、]?運費[？?]?$/;
export const PRICE_MENU_QUESTION = "請問想看甜柿還是水蜜桃？";
export const PRICE_MENU_OPTIONS = ["甜柿價格運費", "水蜜桃價格運費"];

export async function handleText(user: LineUserDoc, text: string, replyToken?: string) {
  const userId = user._id;
  await LineUser.updateOne({ _id: userId }, { $set: { lastMessageAt: new Date() } });
  await saveMsg(userId, "user", text);
  // 農場真人接手中：機器人不回，訊息留在後台
  if (botPaused(user)) return;

  // ⑤ 1 分鐘內訊息太多：只在剛超過時提醒一次並通知農場，之後不回（不呼叫 AI，避免被洗費用）
  const flood = await guardSettings()
    .then(async (s) => (s.msgPerMin ? { limit: s.msgPerMin, n: await messagesLastMinute(userId) } : null))
    .catch(() => null);
  if (flood && flood.n > flood.limit) {
    if (flood.n === flood.limit + 1) {
      const msg = "您的訊息有點多，我需要一點時間整理，請稍等一分鐘後再傳，謝謝您！";
      await send(userId, replyToken, [textMsg(msg)]);
      await saveMsg(userId, "model", msg);
      const tt = { user, text } as Turn;
      tt.notes = [];
      await raiseAlert(tt, "human", `客人 1 分鐘內傳了超過 ${flood.limit} 則訊息，機器人先暫停回覆 1 分鐘`).catch((e) => console.error("raiseAlert", e));
    }
    return;
  }

  if (PRICE_MENU.test(text.replace(/\s/g, ""))) {
    await send(userId, replyToken, [withQuickReply(textMsg(PRICE_MENU_QUESTION), PRICE_MENU_OPTIONS.map((label) => ({ label })))]);
    await saveMsg(userId, "model", PRICE_MENU_QUESTION);
    return;
  }
  if (ORDER_MENU.test(text.replace(/\s/g, ""))) {
    await send(userId, replyToken, [withQuickReply(textMsg(ORDER_MENU_QUESTION), SYSTEMS.map(sysQuick))]);
    await saveMsg(userId, "model", ORDER_MENU_QUESTION);
    return;
  }
  void showLoading(userId, 30);

  const t: Turn = { user, text, out: [], quick: [], notes: [], flagged: false, toolErrors: [], qaPhotos: null, links: [] };
  let answer = "";
  let failed = "";
  const sentSomething = () => t.out.length > 0 || !!t.qaPhotos;
  // 題目一字不差（選單按鈕）：照片由程式直接附上，每次都傳，不靠 AI 記得呼叫 get_qa_answer（同一輪 AI 再呼叫也不會重複傳）
  await exactQa(text)
    .then((q) => {
      if (!q) return null;
      t.forcePhotosFor = String(q._id);
      return rawHandlers(t).get_qa_answer({ qa_id: String(q._id) });
    })
    .catch((e) => console.error("exactQa", e));
  try {
    const faq = await qaPromptText().catch((e) => (console.error("qaPromptText", e), ""));
    const [hist, last] = await Promise.all([history(userId), lastOrderText(userId).catch(() => "")]);
    answer = await chat(systemPrompt(new Date(), user.displayName, faq, last), hist, TOOLS, handlers(t));
  } catch (e) {
    console.error("chat", e);
    failed = e instanceof Error ? e.message : String(e);
    answer = sentSomething() ? "" : SORRY;
  }
  answer = addMissingLinks(stripNotes(answer), t.links);
  if (!answer && !sentSomething()) answer = SORRY;

  // 保險：機器人跟客人說「已請老闆處理」，或系統出錯沒回答到，但沒有呼叫 flag_customer → 一定要通知農場
  if (!t.flagged) {
    const why =
      answer === SORRY
        ? `機器人出錯，沒有回答到客人（${(failed || t.toolErrors[0] || "AI 沒有回覆").slice(0, 80)}）`
        : PROMISED_HUMAN.test(answer)
          ? t.toolErrors.length
            ? `系統出錯，機器人已跟客人說會請你處理：${t.toolErrors[0]}`
            : `機器人跟客人說會請你處理：「${previewText(answer).slice(0, 60)}」`
          : "";
    if (why) await raiseAlert(t, "human", why).catch((e) => console.error("raiseAlert", e));
  }

  // 問答照片：先照片再文字／只傳照片（這時的文字只會是回答別的事）→ 照片在前；其他 → 文字在前
  const text_ = answer ? [textMsg(answer)] : [];
  const photos = t.qaPhotos?.msgs ?? [];
  const photoFirst = t.qaPhotos?.mode === "photo_text" || t.qaPhotos?.mode === "photo";
  const msgs: LineMessage[] = [...(photoFirst ? [...photos, ...text_] : [...text_, ...photos]), ...t.out];
  msgs[msgs.length - 1] = withQuickReply(msgs[msgs.length - 1], t.quick);
  await send(userId, replyToken, msgs);
  await saveMsg(userId, "model", [answer, ...t.notes].filter(Boolean).join("\n"));
}

/* ---------- 按鈕（postback） ---------- */
async function handlePostback(user: LineUserDoc, data: string, replyToken: string) {
  const [kind, a, b] = data.split(":");
  const userId = user._id;

  if (kind === "confirm" && a) return confirmOrder(user, a, replyToken);

  if (kind === "edit" && a) {
    await setStage(userId, "fill", { missing: "客人要修改確認卡" });
    const msg = "好的，請告訴我要修改哪裡（例如：改成 4 盒、換收件地址、改送達時段），我再重新整理一次給您確認。";
    await saveMsg(userId, "user", "（按下「我要修改」）");
    await send(userId, replyToken, [textMsg(msg)]);
    await saveMsg(userId, "model", msg);
    return;
  }

  if (kind === "order" && isSys(a) && b) {
    const p = (await getProducts(a)).products.find((x) => x.id === b);
    // 產品卡片上的「訂這個」：額滿／停止接單就直接告訴客人
    const cap = await checkCapacity(a, [{ id: b, qty: 1 }]).catch(() => ({ ok: true as const }));
    if (!cap.ok) return handleText(user, `我要訂${p?.name ?? b}（${SYS_INFO[a].label}，貨號 ${b}；系統：這個規格${CAP_LABEL[cap.status]}）`, replyToken);
    await setStage(userId, "fill", { sys: a, missing: "訂購者、收件者資料" });
    return handleText(user, `我要訂${p?.name ?? b}（${SYS_INFO[a].label}，貨號 ${b}）`, replyToken);
  }

  if (kind === "photo" && isSys(a) && b) {
    const p = (await getProducts(a)).products.find((x) => x.id === b);
    const img = p ? productImg(a, p.picture) : null;
    await send(userId, replyToken, [img ? imageMsg(img) : textMsg("這個規格目前沒有照片，不好意思！")]);
    return;
  }

  if (kind === "lookup" && isSys(a)) return lookupAsk(user, a, replyToken);
  if (kind === "lookupme" && isSys(a)) return lookupMine(user, a, replyToken);

  if (kind === "nofollow") {
    await LineUser.updateOne({ _id: userId }, { $set: { followups: 2 } });
    const msg = "好的，不打擾您了！有需要隨時傳訊息給我就可以囉。";
    await saveMsg(userId, "user", "先不用了");
    await send(userId, replyToken, [textMsg(msg)]);
    await saveMsg(userId, "model", msg);
    return;
  }

  // 其他按鈕當成文字訊息
  if (data) return handleText(user, data, replyToken);
}

async function confirmOrder(user: LineUserDoc, ref: string, replyToken: string) {
  const userId = user._id;
  await saveMsg(userId, "user", "確認下單");
  const minDate = new Date(Date.now() - DRAFT_DAYS * 86400_000);
  const draft = await OrderDraft.findOneAndUpdate(
    { _id: ref, userId, status: "pending", createdAt: { $gte: minDate } },
    { $set: { status: "creating" } },
    { returnDocument: "after" },
  ).lean();

  if (!draft) {
    const old = await OrderDraft.findOne({ _id: ref, userId }).lean();
    const msg =
      old?.status === "created"
        ? `這筆訂單已經成立囉（${SYS_INFO[old.sys].label} 訂單流水號 ${old.orderId}），不用再按一次。`
        : old?.status === "creating"
          ? "訂單正在建立中，請稍候…"
          : "這張確認卡已經失效（可能已修改過或超過 3 天），請再告訴我一次要訂的內容，我重新整理給您確認。";
    await send(userId, replyToken, [textMsg(msg)]);
    await saveMsg(userId, "model", msg);
    return;
  }

  // 送出確認卡之後才被禁止下單、或 24 小時內筆數已達上限：這張不能成立
  const blocked = await orderBlockedReply(userId);
  if (blocked) {
    await OrderDraft.updateOne({ _id: ref }, { $set: { status: "cancelled", error: "guard: blocked or daily limit" } });
    await send(userId, replyToken, [textMsg(blocked.reply)]);
    await saveMsg(userId, "model", blocked.reply);
    return;
  }

  // 送出確認卡之後才額滿／停止接單：這張不能成立
  const cap = await checkCapacity(draft.sys, draft.data.items).catch(() => ({ ok: true as const }));
  if (!cap.ok) {
    await OrderDraft.updateOne({ _id: ref }, { $set: { status: "cancelled", error: `capacity: ${cap.product} ${cap.status}` } });
    const msg = `${cap.reply}\n（這張確認卡沒有成立，要改訂其他規格的話直接告訴我就可以）`;
    await send(userId, replyToken, [textMsg(msg)]);
    await saveMsg(userId, "model", msg);
    return;
  }

  try {
    const r = await createOrder(draft.sys, draft._id, draft.data, userId, user.displayName);
    await OrderDraft.updateOne({ _id: ref }, { $set: { status: "created", orderId: r.orderId, orderedAt: new Date() } });
    await LineUser.updateOne({ _id: userId }, { $set: { lastOrderAt: new Date(), interest: null, followups: 0, lastFollowupAt: null } });
    await setStage(userId, "ordered", { sys: draft.sys });
    await send(userId, replyToken, [successCard(draft, r.orderId)]);
    await saveMsg(userId, "model", `[訂單已成立：${SYS_INFO[draft.sys].label} 訂單流水號 ${r.orderId}，總金額 ${draft.quote.total} 元，已傳送下單完成卡]`);
  } catch (e) {
    const closed = e instanceof Ll3Error && e.message === "closed";
    await OrderDraft.updateOne({ _id: ref }, { $set: { status: closed ? "cancelled" : "pending", error: String(e) } });
    console.error("createOrder", e);
    const msg = closed
      ? `不好意思，${SYS_INFO[draft.sys].label}剛好已經停止接單，這筆訂單沒有成立。`
      : e instanceof Ll3Error
        ? `訂單沒有成立：${e.message}。請告訴我要修改的地方，或再按一次「確認下單」。`
        : `訂單系統暫時連不上，訂單還沒有成立。請過幾分鐘再按一次「確認下單」，或來電 ${FARM.phone}。`;
    await send(userId, replyToken, [textMsg(msg)]);
    await saveMsg(userId, "model", msg);
  }
}
