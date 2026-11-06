import { randomUUID } from "node:crypto";
import { connectDB } from "./mongodb";
import { ChatMessage, LineUser, OrderDraft, WebhookEvent, type LineUserDoc, type OrderInput } from "./models";
import { botPaused, logMessage, setStage } from "./progress";
import { getProfile, imageMsg, send, showLoading, textMsg, withQuickReply, type LineMessage, type QuickItem } from "./line";
import { chat, type Content, type FunctionDecl, type ToolHandler } from "./gemini";
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
import { confirmCard, deliveryText, orderCarousel, payText, productCarousel, successCard } from "./flex";
import { imgSig } from "./sign";

const HISTORY = 15;
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
  out: LineMessage[];
  quick: QuickItem[];
  notes: string[];
}

const TOOLS: FunctionDecl[] = [
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
        delivery: { type: "string", enum: ["AM", "FM", "NIGHT"], description: "AM=早上08~12 FM=中午12~18 NIGHT=晚上18~22" },
        pay: { type: "string", enum: ["cod", "atm", "card"], description: "cod=貨到付款 atm=匯款或ATM轉帳 card=刷卡繳費" },
        memo: { type: "string", description: "客人的其他交代事項（沒有就省略）" },
      },
      required: ["product", "items", "buyer_name", "buyer_phone", "recipient_same", "address", "delivery", "pay"],
    },
  },
  {
    name: "lookup_orders",
    description: "用訂購者姓名或電話查詢訂單（甜柿、水蜜桃都會查），系統會傳訂單卡片給客人。",
    parameters: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" } } },
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

function handlers(t: Turn): Record<string, ToolHandler> {
  return {
    async get_products(a) {
      const sys = asSys(a.product);
      const r = await getProducts(sys);
      await markInterest(t.user, sys);
      return { product: SYS_INFO[sys].label, open: r.open, closedMessage: r.open ? undefined : r.closedMsg, products: r.products.map((p) => ({ id: p.id, name: p.name, price: p.price })) };
    },

    async send_product_photos(a) {
      const sys = asSys(a.product);
      const ids = Array.isArray(a.product_ids) ? (a.product_ids as unknown[]).map(String) : [];
      const r = await getProducts(sys);
      const list = r.products.filter((p) => !ids.length || ids.includes(p.id));
      if (!list.length) return { error: "沒有這些商品" };
      t.out.push(productCarousel(sys, list.map((p) => ({ p, img: productImg(sys, p.picture) }))));
      t.notes.push(`[已傳送${SYS_INFO[sys].label}產品卡片：${list.map((p) => `${p.name} ${p.price}元`).join("、")}]`);
      await markInterest(t.user, sys);
      return { sent: list.length, open: r.open, closedMessage: r.open ? undefined : r.closedMsg };
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
        delivery: a.delivery === "FM" || a.delivery === "NIGHT" ? a.delivery : "AM",
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

      const p = await getProducts(sys);
      if (!p.open) return { error: `${SYS_INFO[sys].label}目前沒有開放訂購`, closedMessage: p.closedMsg };
      let q;
      try {
        q = await quote(sys, items, data.pay);
      } catch (e) {
        if (e instanceof Ll3Error) return { error: e.message };
        throw e;
      }
      // 之前還沒確認的訂單作廢，只留這一張
      await OrderDraft.updateMany({ userId: t.user._id, status: "pending" }, { $set: { status: "cancelled" } });
      const draft = await OrderDraft.create({ _id: randomUUID().replace(/-/g, ""), userId: t.user._id, sys, data, quote: q });
      t.out.push(confirmCard(draft.toObject()));
      t.notes.push(`[已傳送確認卡：${SYS_INFO[sys].label} ${q.lines.map((l) => `${l.name}x${l.qty}`).join("、")}，訂購者 ${data.buyerName} ${data.buyerPhone}，收件者 ${data.recipientSame ? "同訂購者" : `${data.recipientName} ${data.recipientPhone}`}，地址 ${data.address}，${deliveryText(data.delivery)}，${payText(data.pay)}，總金額 ${q.total} 元；等客人按確認下單]`);
      await markInterest(t.user, sys);
      await setStage(t.user._id, "confirm", { sys, contact: { name: data.buyerName, phone: data.buyerPhone } });
      return { ok: true, total: q.total, ship: q.ship, codFee: q.cod, boxes: q.boxes, note: "確認卡已傳給客人，請客人核對後按「確認下單」" };
    },

    async lookup_orders(a) {
      const name = str(a.name);
      const phone = str(a.phone);
      if (!name && phone.replace(/\D/g, "").length < 8) return { error: "請客人提供訂購者姓名或完整電話" };
      const found: { sys: Sys; o: OrderInfo }[] = [];
      const errors: string[] = [];
      await Promise.all(
        SYSTEMS.map(async (sys) => {
          try {
            for (const o of await queryOrders(sys, name, phone)) found.push({ sys, o });
          } catch (e) {
            errors.push(`${SYS_INFO[sys].label}訂單系統暫時查不到（${e instanceof Error ? e.message : e}）`);
          }
        }),
      );
      found.sort((x, y) => (y.o.time ?? "").localeCompare(x.o.time ?? ""));
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
        const text = str(a.reason) || (a.status === "human" ? "客人想找真人" : "機器人答不出來");
        await LineUser.updateOne({ _id: t.user._id }, { $set: { alert: { kind: a.status, text: text.slice(0, 200), at: new Date() } } });
        t.notes.push(`[已通知農場主人：${text}]`);
        return { ok: true, note: "已通知農場主人，請告訴客人農場會再跟他聯絡，急的話可以直接打電話" };
      }
      return { error: "status 不對" };
    },
  };
}

async function history(userId: string): Promise<Content[]> {
  const rows = await ChatMessage.find({ userId }).sort({ at: -1 }).limit(HISTORY).lean();
  const list: Content[] = rows.reverse().map((r) => ({ role: r.role, parts: [{ text: r.text }] }));
  while (list.length && list[0].role !== "user") list.shift();
  return list;
}

export async function handleText(user: LineUserDoc, text: string, replyToken?: string) {
  const userId = user._id;
  await LineUser.updateOne({ _id: userId }, { $set: { lastMessageAt: new Date() } });
  await saveMsg(userId, "user", text);
  // 農場真人接手中：機器人不回，訊息留在後台
  if (botPaused(user)) return;
  void showLoading(userId, 30);

  const t: Turn = { user, out: [], quick: [], notes: [] };
  let answer = "";
  try {
    answer = await chat(systemPrompt(new Date(), user.displayName), await history(userId), TOOLS, handlers(t));
  } catch (e) {
    console.error("chat", e);
    answer = t.out.length ? "" : SORRY;
  }
  if (!answer && !t.out.length) answer = SORRY;

  const msgs: LineMessage[] = [...(answer ? [textMsg(answer)] : []), ...t.out];
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
    await setStage(userId, "fill", { sys: a, missing: "訂購者、收件者資料" });
    return handleText(user, `我要訂${p?.name ?? b}（${SYS_INFO[a].label}，貨號 ${b}）`, replyToken);
  }

  if (kind === "photo" && isSys(a) && b) {
    const p = (await getProducts(a)).products.find((x) => x.id === b);
    const img = p ? productImg(a, p.picture) : null;
    await send(userId, replyToken, [img ? imageMsg(img) : textMsg("這個規格目前沒有照片，不好意思！")]);
    return;
  }

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
        ? `這筆訂單已經成立囉（${SYS_INFO[old.sys].label} No.${old.orderId}），不用再按一次。`
        : old?.status === "creating"
          ? "訂單正在建立中，請稍候…"
          : "這張確認卡已經失效（可能已修改過或超過 3 天），請再告訴我一次要訂的內容，我重新整理給您確認。";
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
    await saveMsg(userId, "model", `[訂單已成立：${SYS_INFO[draft.sys].label} No.${r.orderId}，總金額 ${draft.quote.total} 元，已傳送下單完成卡]`);
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
