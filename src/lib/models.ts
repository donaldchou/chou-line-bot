import { Schema, model, models, type Model } from "mongoose";
import type { Sys } from "./ll3";

/** LINE 好友（_id = LINE userId） */
export interface LineUserDoc {
  _id: string;
  displayName: string;
  pictureUrl?: string;
  blocked: boolean;
  lastMessageAt?: Date;
  /** 最近一次詢問商品（還沒下單）：每 6 小時關心一次，最多 2 次 */
  interest?: { sys: Sys; at: Date } | null;
  followups: number;
  lastFollowupAt?: Date | null;
  lastOrderAt?: Date | null;
  /** 客戶進度（管理後台用） */
  stage?: Stage | null;
  stageAt?: Date | null;
  /** 這一輪（從詢問開始）到達各階段的時間，用來算「詢問 → 結單」 */
  cycle?: { at: Date; sys?: Sys; fill?: Date; confirm?: Date; ordered?: Date; followed?: boolean } | null;
  /** 填資料中還缺的項目 */
  missing?: string;
  /** 從下單資料整理出的訂購者 */
  contact?: { name: string; phone: string } | null;
  /** 需要真人處理（機器人答不出來、客人想找真人） */
  alert?: { kind: AlertKind; text: string; at: Date } | null;
  /** 真人接手：這個時間之前機器人不自動回覆 */
  botPausedUntil?: Date | null;
  /** 農場備註（客人看不到） */
  memo?: string;
  /** 最後一則訊息（列表顯示用） */
  lastText?: string;
  lastRole?: "user" | "model";
  /** 最後一則訊息（不論誰傳）的時間 */
  lastAt?: Date;
  createdAt: Date;
}
export type Stage = "ask" | "fill" | "confirm" | "ordered" | "shipped" | "lost";
export type AlertKind = "unanswered" | "human";

const LineUserSchema = new Schema<LineUserDoc>(
  {
    _id: { type: String, required: true },
    displayName: { type: String, default: "" },
    pictureUrl: String,
    blocked: { type: Boolean, default: false },
    lastMessageAt: Date,
    interest: { type: new Schema({ sys: String, at: Date }, { _id: false }), default: null },
    followups: { type: Number, default: 0 },
    lastFollowupAt: { type: Date, default: null },
    lastOrderAt: { type: Date, default: null },
    stage: { type: String, default: null },
    stageAt: { type: Date, default: null },
    cycle: { type: Schema.Types.Mixed, default: null },
    missing: String,
    contact: { type: new Schema({ name: String, phone: String }, { _id: false }), default: null },
    alert: { type: new Schema({ kind: String, text: String, at: Date }, { _id: false }), default: null },
    botPausedUntil: { type: Date, default: null },
    memo: { type: String, default: "" },
    lastText: String,
    lastRole: String,
    lastAt: Date,
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
LineUserSchema.index({ "interest.at": 1, followups: 1 });
LineUserSchema.index({ lastAt: -1 });

/** 對話紀錄（給 AI 參考最近 15 筆） */
export interface ChatMessageDoc {
  userId: string;
  role: "user" | "model";
  text: string;
  /** model 訊息是誰傳的：沒填＝機器人，admin＝農場（後台真人回覆） */
  by?: "admin";
  at: Date;
}
const ChatMessageSchema = new Schema<ChatMessageDoc>(
  {
    userId: { type: String, required: true },
    role: { type: String, required: true },
    text: { type: String, required: true },
    by: String,
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
ChatMessageSchema.index({ userId: 1, at: -1 });

/** 等待客人按「確認下單」的訂單（_id = ref，建單時當作不重複的編號） */
export interface OrderDraftDoc {
  _id: string;
  userId: string;
  sys: Sys;
  status: "pending" | "creating" | "created" | "cancelled";
  data: OrderInput;
  quote: Quote;
  orderId?: number;
  /** 客人按「確認下單」、訂單建立的時間 */
  orderedAt?: Date;
  error?: string;
  createdAt: Date;
}
export interface OrderInput {
  buyerName: string;
  buyerSex: "M" | "F";
  buyerPhone: string;
  buyerPhone2?: string;
  buyerEmail?: string;
  recipientSame: boolean;
  recipientName?: string;
  recipientPhone?: string;
  recipientPhone2?: string;
  address: string;
  delivery: "AM" | "FM" | "NIGHT";
  pay: "cod" | "atm" | "card";
  items: { id: string; qty: number }[];
  memo?: string;
}
export interface Quote {
  lines: { id: string; name: string; price: number; qty: number }[];
  boxes: number;
  items: number;
  ship: number;
  cod: number;
  total: number;
}
const OrderDraftSchema = new Schema<OrderDraftDoc>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    sys: { type: String, required: true },
    status: { type: String, default: "pending" },
    data: { type: Schema.Types.Mixed, required: true },
    quote: { type: Schema.Types.Mixed, required: true },
    orderId: Number,
    orderedAt: Date,
    error: String,
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
OrderDraftSchema.index({ status: 1, orderedAt: -1 });

/** LINE webhook 事件去重（LINE 可能重送），保留 2 天 */
const WebhookEventSchema = new Schema(
  { _id: { type: String, required: true }, at: { type: Date, default: () => new Date(), expires: 172800 } },
  { versionKey: false },
);

/** 寄出通知紀錄 */
const NotifyLogSchema = new Schema(
  {
    sys: String,
    orderId: Number,
    userId: String,
    obts: [String],
    images: Number,
    ok: Boolean,
    error: String,
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

export const LineUser = (models.LineUser as Model<LineUserDoc>) || model<LineUserDoc>("LineUser", LineUserSchema, "lineUsers");
export const ChatMessage =
  (models.ChatMessage as Model<ChatMessageDoc>) || model<ChatMessageDoc>("ChatMessage", ChatMessageSchema, "messages");
export const OrderDraft =
  (models.OrderDraft as Model<OrderDraftDoc>) || model<OrderDraftDoc>("OrderDraft", OrderDraftSchema, "orderDrafts");
export const WebhookEvent = models.WebhookEvent || model("WebhookEvent", WebhookEventSchema, "webhookEvents");
export const NotifyLog = models.NotifyLog || model("NotifyLog", NotifyLogSchema, "notifyLogs");
