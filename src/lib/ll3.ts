import iconv from "iconv-lite";
import { ll3Token } from "./sign";
import type { OrderInput, Quote } from "./models";

/** ll3 舊訂單系統：kaki＝甜柿（/kaki_order），peach＝水蜜桃（/order） */
export type Sys = "kaki" | "peach";
export const SYSTEMS: Sys[] = ["kaki", "peach"];

// LL3_HOST 只在本機測試時設定（指向 ASP 測試環境），正式環境不用設
const HOST = (process.env.LL3_HOST || "http://www.ll3.com.tw").replace(/\/$/, "");
export const SYS_INFO: Record<Sys, { label: string; dir: string }> = {
  kaki: { label: "甜柿", dir: "kaki_order" },
  peach: { label: "水蜜桃", dir: "order" },
};

export const sysBase = (sys: Sys) => `${HOST}/${SYS_INFO[sys].dir}`;
/** 客人自己查訂單的網頁 */
export const queryPage = (sys: Sys) => `${sysBase(sys)}/queryorder.asp`;
export const isSys = (v: unknown): v is Sys => v === "kaki" || v === "peach";

/** Big5 沒有的字先轉成 &#NNNNN;（同網站下單），再整串轉成「x＋UTF-16 hex」送給 ASP */
export function encText(s: string | undefined | null) {
  let out = "";
  for (const ch of String(s ?? "").trim()) {
    const ok = iconv.decode(iconv.encode(ch, "big5"), "big5") === ch;
    out += ok ? ch : `&#${ch.codePointAt(0)};`;
  }
  let hex = "x";
  for (let i = 0; i < out.length; i++) hex += out.charCodeAt(i).toString(16).padStart(4, "0");
  return hex;
}

/** ASP 回來的文字裡 &#NNNNN; 還原成原字 */
export function decText(s: string | null | undefined) {
  return String(s ?? "").replace(/&#(\d{1,7});/g, (_, n) => String.fromCodePoint(Number(n)));
}

async function call<T>(sys: Sys, action: string, opts: { query?: Record<string, string>; form?: Record<string, string>; timeout?: number } = {}) {
  const url = new URL(`${sysBase(sys)}/line_api.asp`);
  url.searchParams.set("a", action);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: opts.form ? "POST" : "GET",
    headers: {
      "x-line-token": ll3Token("line"),
      ...(opts.form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: opts.form ? new URLSearchParams(opts.form).toString() : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(opts.timeout ?? 20_000),
  });
  const text = await res.text();
  let json: { ok?: boolean; error?: string } & T;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${SYS_INFO[sys].label}訂單系統回應錯誤（HTTP ${res.status}）`);
  }
  if (!json.ok) throw new Ll3Error(json.error || "unknown");
  return json;
}

export class Ll3Error extends Error {}

export interface Product {
  id: string;
  name: string;
  price: number;
  picture: string;
}
export async function getProducts(sys: Sys) {
  const r = await call<{ open: boolean; closedMsg: string; products: Product[] }>(sys, "products");
  return {
    open: r.open,
    closedMsg: decText(r.closedMsg),
    products: r.products.map((p) => ({ ...p, name: decText(p.name) })),
  };
}

const itemsParam = (items: { id: string; qty: number }[]) => items.map((i) => `${i.id}:${i.qty}`).join(",");

export async function quote(sys: Sys, items: { id: string; qty: number }[], pay: string): Promise<Quote> {
  const r = await call<Quote>(sys, "quote", { form: { items: itemsParam(items), pay } });
  return { lines: r.lines.map((l) => ({ ...l, name: decText(l.name) })), boxes: r.boxes, items: r.items, ship: r.ship, cod: r.cod, total: r.total };
}

export async function createOrder(sys: Sys, ref: string, d: OrderInput, uid: string, lineName: string) {
  const form: Record<string, string> = {
    ref,
    uid,
    line_name: encText(lineName),
    b_name: encText(d.buyerName),
    b_sex: d.buyerSex,
    b_phone: encText(d.buyerPhone),
    b_phone2: encText(d.buyerPhone2),
    b_email: encText(d.buyerEmail),
    same: d.recipientSame ? "1" : "0",
    r_name: encText(d.recipientName),
    r_phone: encText(d.recipientPhone),
    r_phone2: encText(d.recipientPhone2),
    addr: encText(d.address),
    arrtime: d.delivery,
    pay: d.pay,
    memo: encText(d.memo),
    items: itemsParam(d.items),
  };
  return call<{ orderId: number; dup: boolean }>(sys, "create", { form });
}

export interface Waybill {
  obt: string;
  pkg: number | null;
  pkgTotal: number | null;
  product: string;
  printed: string | null;
  statusId: string;
  status: string;
  statusTime: string | null;
  jpg: boolean;
}
export interface OrderInfo {
  id: number;
  time: string | null;
  schedule: string;
  pay: string;
  buyer: string;
  buyerPhone?: string;
  recipient: string;
  items: { name: string; qty: number | null }[];
  extras: string;
  boxes: number;
  total: number;
  waybills: Waybill[];
  line?: { uid: string; name: string; notified: string | null; count: number | null } | null;
}
function decOrder(o: OrderInfo): OrderInfo {
  return {
    ...o,
    schedule: decText(o.schedule),
    pay: decText(o.pay),
    buyer: decText(o.buyer),
    recipient: decText(o.recipient),
    extras: decText(o.extras),
    items: o.items.map((i) => ({ ...i, name: decText(i.name) })),
    waybills: o.waybills.map((w) => ({ ...w, product: decText(w.product), status: decText(w.status) })),
    line: o.line ? { ...o.line, name: decText(o.line.name) } : o.line,
  };
}

export async function queryOrders(sys: Sys, name: string, phone: string) {
  const r = await call<{ orders: OrderInfo[] }>(sys, "query", { form: { name: encText(name), phone: encText(phone) } });
  return r.orders.map(decOrder);
}

export async function getOrder(sys: Sys, id: number) {
  const r = await call<{ order: OrderInfo }>(sys, "order", { query: { id: String(id) } });
  return decOrder(r.order);
}

/** 管理後台：機器人建立的訂單（since 之後，最多 100 筆，新的在前） */
export async function listLineOrders(sys: Sys, since: Date) {
  const d = new Date(since.getTime() + 8 * 3600_000); // 台灣日期
  const s = `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  const r = await call<{ orders: OrderInfo[] }>(sys, "list", { form: { since: s }, timeout: 45_000 });
  return r.orders.map(decOrder);
}

export async function markNotified(sys: Sys, id: number, obts: string[]) {
  await call(sys, "notified", { form: { id: String(id), obts: obts.join(",") } });
}

/** 託運單照片（JPG 原始檔） */
export async function getWaybillJpg(sys: Sys, obt: string) {
  const url = new URL(`${sysBase(sys)}/line_api.asp`);
  url.searchParams.set("a", "jpg");
  url.searchParams.set("obt", obt);
  const res = await fetch(url, { headers: { "x-line-token": ll3Token("line") }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("image")) return null;
  return Buffer.from(await res.arrayBuffer());
}

/** 商品照片的網址（product.PICTURE 是相對 kaki_order/ 或 order/ 的路徑）；不合格回傳 null */
export function productPictureUrl(sys: Sys, picture: string) {
  const p = picture.trim().replace(/\\/g, "/");
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) {
    const u = new URL(p);
    return u.hostname.endsWith("ll3.com.tw") ? u.toString() : null;
  }
  if (p.includes("..")) return null;
  if (p.startsWith("/")) return `${HOST}${encodeURI(p)}`;
  return `${sysBase(sys)}/${encodeURI(p)}`;
}
