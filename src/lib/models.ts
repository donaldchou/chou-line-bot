import { Schema, model, models, type Model } from "mongoose";
import type { Sys } from "./ll3";

/** LINE 好友（_id = LINE userId） */
export interface LineUserDoc {
  _id: string;
  displayName: string;
  pictureUrl?: string;
  blocked: boolean;
  lastMessageAt?: Date;
  /** 問過的品項（分群用，只增不減） */
  asked?: string[];
  /** 最近一次收到群發的時間（7 天內不再群發） */
  lastBroadcastAt?: Date | null;
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
    asked: { type: [String], default: undefined },
    lastBroadcastAt: { type: Date, default: null },
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

/** 「需要你處理」的紀錄：處理完也留著，用來算轉真人比例、處理時間 */
export interface AlertLogDoc {
  userId: string;
  kind: AlertKind;
  text: string;
  at: Date;
  resolvedAt: Date | null;
  /** reply＝真人回覆、resolve＝按「已處理」 */
  how?: "reply" | "resolve";
  by?: string;
}
const AlertLogSchema = new Schema<AlertLogDoc>(
  {
    userId: { type: String, required: true },
    kind: { type: String, required: true },
    text: { type: String, default: "" },
    at: { type: Date, default: () => new Date() },
    resolvedAt: { type: Date, default: null },
    how: String,
    by: String,
  },
  { versionKey: false },
);
AlertLogSchema.index({ at: -1 });
AlertLogSchema.index({ userId: 1, resolvedAt: 1 });
export const AlertLog =
  (models.AlertLog as Model<AlertLogDoc>) || model<AlertLogDoc>("AlertLog", AlertLogSchema, "alertLogs");

/** 接單設定：每個品項（_id = "sys:貨號"） */
export interface ProductSettingDoc {
  _id: string;
  sys: string;
  productId: string;
  /** open＝接單中、full＝本週額滿、stop＝停止接單 */
  status: "open" | "full" | "stop";
  /** 每週上限盒數（LINE 訂單），null＝不限 */
  cap: number | null;
  updatedAt: Date;
  updatedBy?: string;
}
const ProductSettingSchema = new Schema<ProductSettingDoc>(
  {
    _id: { type: String, required: true },
    sys: { type: String, required: true },
    productId: { type: String, required: true },
    status: { type: String, default: "open" },
    cap: { type: Number, default: null },
    updatedAt: { type: Date, default: () => new Date() },
    updatedBy: String,
  },
  { versionKey: false },
);
export const ProductSetting =
  (models.ProductSetting as Model<ProductSettingDoc>) ||
  model<ProductSettingDoc>("ProductSetting", ProductSettingSchema, "productSettings");

/** 群發訊息 */
export interface BroadcastDoc {
  _id: string;
  /** 分群（"all"＝全部好友） */
  segs: string[];
  text: string;
  /** 附上的產品卡片：kaki / peach */
  cards: string[];
  orderButton: boolean;
  status: "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  scheduledAt: Date;
  sentAt?: Date | null;
  /** 實際傳出的對象（送出時才決定） */
  userIds: string[];
  sent: number;
  failed: number;
  error?: string;
  createdBy: string;
  createdAt: Date;
}
const BroadcastSchema = new Schema<BroadcastDoc>(
  {
    _id: { type: String, required: true },
    segs: [String],
    text: { type: String, default: "" },
    cards: [String],
    orderButton: { type: Boolean, default: false },
    status: { type: String, default: "scheduled" },
    scheduledAt: { type: Date, required: true },
    sentAt: { type: Date, default: null },
    userIds: { type: [String], default: [] },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    error: String,
    createdBy: { type: String, default: "" },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
BroadcastSchema.index({ status: 1, scheduledAt: 1 });
export const Broadcast =
  (models.Broadcast as Model<BroadcastDoc>) || model<BroadcastDoc>("Broadcast", BroadcastSchema, "broadcasts");

/** 後台登入帳號（密碼只存 scrypt 雜湊；輸出前一定要用 publicUser() 拿掉） */
export interface AdminUserDoc {
  _id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: "admin" | "user";
  active: boolean;
  /** 一般使用者：在「一般使用者可以看的頁面」之外，這個帳號另外看不到的頁面 */
  hiddenPages: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
}
const AdminUserSchema = new Schema<AdminUserDoc>(
  {
    _id: { type: String, required: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    name: { type: String, default: "" },
    role: { type: String, enum: ["admin", "user"], default: "user" },
    active: { type: Boolean, default: true },
    hiddenPages: { type: [String], default: [] },
    lastLoginAt: { type: Date, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

/** 後台設定（_id = 設定名稱，例如 pageAccess） */
const AdminSettingSchema = new Schema({ _id: { type: String, required: true }, allowed: [String] }, { versionKey: false, strict: false });

export const AdminUser =
  (models.AdminUser as Model<AdminUserDoc>) || model<AdminUserDoc>("AdminUser", AdminUserSchema, "adminUsers");
export const AdminSetting = models.AdminSetting || model("AdminSetting", AdminSettingSchema, "adminSettings");

export const LineUser =(models.LineUser as Model<LineUserDoc>) || model<LineUserDoc>("LineUser", LineUserSchema, "lineUsers");
export const ChatMessage =
  (models.ChatMessage as Model<ChatMessageDoc>) || model<ChatMessageDoc>("ChatMessage", ChatMessageSchema, "messages");
export const OrderDraft =
  (models.OrderDraft as Model<OrderDraftDoc>) || model<OrderDraftDoc>("OrderDraft", OrderDraftSchema, "orderDrafts");
export const WebhookEvent = models.WebhookEvent || model("WebhookEvent", WebhookEventSchema, "webhookEvents");
export const NotifyLog = models.NotifyLog || model("NotifyLog", NotifyLogSchema, "notifyLogs");
