import { connectDB } from "./mongodb";
import { ChatMessage, LineUser, OrderDraft, type LineUserDoc, type OrderDraftDoc, type Stage } from "./models";
import { getOrder, getProducts, listLineOrders, SYS_INFO, SYSTEMS, type OrderInfo, type Sys } from "./ll3";
import { botPaused, STAGES, viewStage } from "./progress";

/* 管理後台的資料（只給 /api/admin/* 用，呼叫前要先檢查登入） */

const H = 3600_000;
const DAY = 86400_000;
const TZ = 8 * H;
const DRAFT_DAYS = 3;
/** 確認卡送出超過幾小時沒按，就列在「需要你處理」 */
const CONFIRM_ALERT_H = 3;

/** 台灣時間某天 00:00 */
export function twDay(now: Date, addDays = 0) {
  const d = Math.floor((now.getTime() + TZ) / DAY) * DAY;
  return new Date(d - TZ + addDays * DAY);
}
export function twWeek(now: Date) {
  const dow = new Date(now.getTime() + TZ).getUTCDay();
  return twDay(now, -((dow + 6) % 7));
}
export function twMonth(now: Date) {
  const t = new Date(now.getTime() + TZ);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1) - TZ);
}
/** ll3 的時間字串（台灣時間 "YYYY-MM-DD HH:mm"） */
const ll3Time = (s: string | null) => (s ? new Date(`${s.replace(" ", "T")}:00+08:00`) : null);

const label = (sys?: Sys | null) => (sys ? SYS_INFO[sys]?.label ?? "" : "");
const withLabel = (sys: Sys, name: string) => (name.includes(label(sys)) ? name : `${label(sys)} ${name}`);
const linesText = (d: Pick<OrderDraftDoc, "sys" | "quote">) =>
  d.quote.lines.map((l) => `${withLabel(d.sys, l.name)} × ${l.qty}`).join("、");

/* ---------- ll3 訂單（60 秒快取，避免每次輪詢都打舊系統） ---------- */

export interface LineOrder {
  sys: Sys;
  o: OrderInfo;
  at: Date | null;
  state: "ord" | "prt" | "ntf" | "cxl";
}
const orderState = (o: OrderInfo): LineOrder["state"] =>
  o.schedule.includes("取消") ? "cxl" : o.line?.notified ? "ntf" : o.waybills.length ? "prt" : "ord";

const cache = new Map<number, { at: number; p: Promise<{ orders: LineOrder[]; errors: string[] }> }>();
export function ll3Orders(days: number, fresh = false) {
  const hit = cache.get(days);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.p;
  const since = new Date(Date.now() - days * DAY);
  const p = (async () => {
    const orders: LineOrder[] = [];
    const errors: string[] = [];
    await Promise.all(
      SYSTEMS.map(async (sys) => {
        try {
          for (const o of await listLineOrders(sys, since)) orders.push({ sys, o, at: ll3Time(o.time), state: orderState(o) });
        } catch (e) {
          errors.push(`${label(sys)}訂單系統連不上：${e instanceof Error ? e.message : e}`);
        }
      }),
    );
    orders.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
    return { orders, errors };
  })();
  cache.set(days, { at: Date.now(), p });
  p.then((r) => r.errors.length && cache.delete(days)).catch(() => cache.delete(days));
  return p;
}
export const clearOrderCache = () => cache.clear();

async function shopStatus() {
  return Promise.all(
    SYSTEMS.map(async (sys) => {
      try {
        return { sys, label: label(sys), open: (await getProducts(sys)).open as boolean | null };
      } catch {
        return { sys, label: label(sys), open: null };
      }
    }),
  );
}

/* ---------- 客戶列 ---------- */

export interface CustomerRow {
  id: string;
  name: string;
  picture?: string;
  contact: { name: string; phone: string } | null;
  stage: Stage;
  sys: Sys | null;
  prod: string;
  extra: string;
  lastText: string;
  lastRole: string;
  lastAt: string | null;
  followups: number;
  lastFollowupAt: string | null;
  orders: number;
  boxes: number;
  amount: number;
  alert: { kind: string; text: string; at: string } | null;
  paused: boolean;
  pending: { total: number; at: string; lines: string } | null;
}

type Agg = { _id: string; n: number; boxes: number; amount: number; lastNo?: number; lastSys?: Sys };

async function orderAgg(userIds?: string[]) {
  const rows = await OrderDraft.aggregate<Agg>([
    { $match: { status: "created", ...(userIds ? { userId: { $in: userIds } } : {}) } },
    { $sort: { orderedAt: -1 } },
    {
      $group: {
        _id: "$userId",
        n: { $sum: 1 },
        boxes: { $sum: "$quote.boxes" },
        amount: { $sum: "$quote.total" },
        lastNo: { $first: "$orderId" },
        lastSys: { $first: "$sys" },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id, r]));
}

async function pendingDrafts(now: Date, userIds?: string[]) {
  const rows = await OrderDraft.find({
    status: "pending",
    createdAt: { $gte: new Date(now.getTime() - DRAFT_DAYS * DAY) },
    ...(userIds ? { userId: { $in: userIds } } : {}),
  })
    .sort({ createdAt: -1 })
    .lean<OrderDraftDoc[]>();
  const m = new Map<string, OrderDraftDoc>();
  for (const d of rows) if (!m.has(d.userId)) m.set(d.userId, d);
  return m;
}

function toRow(u: LineUserDoc, now: Date, agg?: Agg, pend?: OrderDraftDoc): CustomerRow {
  const stage = viewStage(u, now);
  const sys = (u.cycle?.sys ?? u.interest?.sys ?? pend?.sys ?? agg?.lastSys ?? null) as Sys | null;
  let prod = label(sys);
  let extra = "";
  if (stage === "fill") extra = u.missing ? `缺${u.missing}` : "";
  if (stage === "confirm" && pend) {
    prod = linesText(pend);
    extra = `NT$ ${pend.quote.total.toLocaleString()}${u.followups ? ` · 已關心 ${u.followups} 次` : ""}`;
  }
  if ((stage === "ordered" || stage === "shipped") && agg?.lastNo) extra = `${label(agg.lastSys)} No.${agg.lastNo}`;
  if (stage === "lost") extra = `已關心 ${u.followups} 次`;
  return {
    id: u._id,
    name: u.displayName || "（沒有名稱）",
    picture: u.pictureUrl,
    contact: u.contact?.name ? { name: u.contact.name, phone: u.contact.phone } : null,
    stage,
    sys,
    prod,
    extra,
    lastText: u.lastText ?? "",
    lastRole: u.lastRole ?? "",
    lastAt: u.lastAt ? new Date(u.lastAt).toISOString() : null,
    followups: u.followups ?? 0,
    lastFollowupAt: u.lastFollowupAt ? new Date(u.lastFollowupAt).toISOString() : null,
    orders: agg?.n ?? 0,
    boxes: agg?.boxes ?? 0,
    amount: agg?.amount ?? 0,
    alert: u.alert ? { kind: u.alert.kind, text: u.alert.text, at: new Date(u.alert.at).toISOString() } : null,
    paused: botPaused(u, now),
    pending: pend ? { total: pend.quote.total, at: new Date(pend.createdAt).toISOString(), lines: linesText(pend) } : null,
  };
}

/* ---------- 總覽 ---------- */

export interface AlertItem {
  kind: "unanswered" | "human" | "confirm" | "notify";
  userId: string | null;
  name: string;
  text: string;
  at: string | null;
  sys?: Sys;
  orderId?: number;
}

export async function overview(now = new Date()) {
  await connectDB();
  const today = twDay(now);
  const week = twWeek(now);
  const ll3 = ll3Orders(30);
  const shop = shopStatus();

  const users = await LineUser.find({
    blocked: false,
    $or: [{ lastAt: { $gte: new Date(now.getTime() - 7 * DAY) } }, { alert: { $ne: null } }],
  })
    .sort({ lastAt: -1 })
    .limit(400)
    .lean<LineUserDoc[]>();
  const ids = users.map((u) => u._id);
  const [agg, pend, todayUsers, newFriends, todayOrders, weekOrders, cycles] = await Promise.all([
    orderAgg(ids),
    pendingDrafts(now),
    ChatMessage.distinct("userId", { role: "user", at: { $gte: today } }),
    LineUser.countDocuments({ createdAt: { $gte: today } }),
    OrderDraft.find({ status: "created", orderedAt: { $gte: today } }).lean<OrderDraftDoc[]>(),
    OrderDraft.find({ status: "created", orderedAt: { $gte: week } }).lean<OrderDraftDoc[]>(),
    LineUser.find({ "cycle.at": { $gte: week } }, { cycle: 1 }).lean<Pick<LineUserDoc, "cycle">[]>(),
  ]);
  const rows = users.map((u) => toRow(u, now, agg.get(u._id), pend.get(u._id)));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const count = (s: Stage) => rows.filter((r) => r.stage === s).length;
  const pendList = [...pend.values()];
  const oldestPend = pendList.reduce((m, d) => Math.max(m, now.getTime() - new Date(d.createdAt).getTime()), 0);

  const { orders, errors } = await ll3;
  const toNotify = orders.filter((x) => x.state === "prt");

  // 需要你處理
  const alerts: AlertItem[] = [];
  for (const r of rows)
    if (r.alert) alerts.push({ kind: r.alert.kind === "human" ? "human" : "unanswered", userId: r.id, name: r.name, text: r.alert.text, at: r.alert.at });
  for (const d of pendList) {
    if (now.getTime() - new Date(d.createdAt).getTime() < CONFIRM_ALERT_H * H) continue;
    const r = byId.get(d.userId);
    alerts.push({
      kind: "confirm",
      userId: d.userId,
      name: r?.name ?? "客人",
      text: `${linesText(d)}，確認卡已送出 ${Math.floor((now.getTime() - new Date(d.createdAt).getTime()) / H)} 小時，客人還沒按「確認下單」`,
      at: new Date(d.createdAt).toISOString(),
    });
  }
  for (const x of toNotify) {
    const printed = x.o.waybills.map((w) => w.printed).filter(Boolean).sort().pop() ?? null;
    alerts.push({
      kind: "notify",
      userId: x.o.line?.uid ?? null,
      name: byId.get(x.o.line?.uid ?? "")?.name ?? x.o.line?.name ?? x.o.buyer,
      text: `${label(x.sys)} No.${x.o.id} 已印託運單，還沒傳 LINE 寄出通知`,
      at: ll3Time(printed)?.toISOString() ?? null,
      sys: x.sys,
      orderId: x.o.id,
    });
  }
  alerts.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  // 看板：每欄最多 12 位
  const cols = STAGES.map((s) => {
    const list = rows.filter((r) => r.stage === s.key);
    return { ...s, count: list.length, items: list.slice(0, 12) };
  });

  // 本週訂購盒數（依品項）
  const boxMap = new Map<string, number>();
  for (const d of weekOrders) for (const l of d.quote.lines) boxMap.set(withLabel(d.sys, l.name), (boxMap.get(withLabel(d.sys, l.name)) ?? 0) + l.qty);
  const bars = [...boxMap.entries()].map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v);

  // 本週詢問 → 結單（這週開始詢問的客人）
  const c = cycles.map((u) => u.cycle!).filter(Boolean);
  const funnel = [
    { name: "問過產品", v: c.length },
    { name: "開始填資料", v: c.filter((x) => x.fill || x.confirm || x.ordered).length },
    { name: "送出確認卡", v: c.filter((x) => x.confirm || x.ordered).length },
    { name: "確認下單", v: c.filter((x) => x.ordered).length },
  ];
  const afterFollow = c.filter((x) => x.ordered && x.followed).length;

  const sum = (ds: OrderDraftDoc[], f: (d: OrderDraftDoc) => number) => ds.reduce((s, d) => s + f(d), 0);
  return {
    now: now.toISOString(),
    shop: await shop,
    kpi: {
      todayUsers: todayUsers.length,
      newFriends,
      open: count("ask") + count("fill"),
      confirm: pendList.length,
      oldestConfirmH: Math.floor(oldestPend / H),
      todayOrders: todayOrders.length,
      todayBoxes: sum(todayOrders, (d) => d.quote.boxes),
      todayAmount: sum(todayOrders, (d) => d.quote.total),
      toNotify: toNotify.length,
      paused: rows.filter((r) => r.paused).length,
    },
    alerts,
    cols,
    bars,
    funnel,
    afterFollow,
    errors,
  };
}

/* ---------- 客戶列表 ---------- */

export async function customers(q: { stage?: string; sys?: string; tag?: string; search?: string; page?: number }, now = new Date()) {
  await connectDB();
  const users = await LineUser.find({ blocked: false }).sort({ lastAt: -1 }).limit(3000).lean<LineUserDoc[]>();
  const [agg, pend] = await Promise.all([orderAgg(), pendingDrafts(now)]);
  let rows = users.map((u) => toRow(u, now, agg.get(u._id), pend.get(u._id)));
  const stageCount: Record<string, number> = { all: rows.length };
  for (const r of rows) stageCount[r.stage] = (stageCount[r.stage] ?? 0) + 1;

  const s = (q.search ?? "").trim();
  if (s) {
    const digits = s.replace(/\D/g, "");
    rows = rows.filter(
      (r) =>
        r.name.includes(s) ||
        r.contact?.name.includes(s) ||
        (digits.length >= 3 && r.contact?.phone.replace(/\D/g, "").includes(digits)),
    );
  }
  if (q.stage && q.stage !== "all") rows = rows.filter((r) => r.stage === q.stage);
  if (q.sys === "kaki" || q.sys === "peach") rows = rows.filter((r) => r.sys === q.sys);
  if (q.tag === "alert")
    rows = rows.filter((r) => r.alert || (r.pending && now.getTime() - new Date(r.pending.at).getTime() >= CONFIRM_ALERT_H * H));
  if (q.tag === "repeat") rows = rows.filter((r) => r.orders >= 2);
  if (q.tag === "paused") rows = rows.filter((r) => r.paused);

  const per = 30;
  const page = Math.max(1, q.page ?? 1);
  return { total: rows.length, page, per, stageCount, rows: rows.slice((page - 1) * per, page * per) };
}

/* ---------- 單一客戶 ---------- */

export async function customerDetail(id: string, now = new Date()) {
  await connectDB();
  const u = await LineUser.findById(id).lean<LineUserDoc>();
  if (!u) return null;
  const [agg, pend, msgs, drafts] = await Promise.all([
    orderAgg([id]),
    pendingDrafts(now, [id]),
    ChatMessage.find({ userId: id }).sort({ at: -1 }).limit(300).lean(),
    OrderDraft.find({ userId: id, status: { $in: ["created", "pending"] } })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean<OrderDraftDoc[]>(),
  ]);
  const row = toRow(u, now, agg.get(id), pend.get(id));
  const p = pend.get(id);

  // 成立的訂單：向 ll3 查目前狀態（最近 5 筆）
  const created = drafts.filter((d) => d.status === "created" && d.orderId);
  const live = await Promise.all(
    created.slice(0, 5).map(async (d) => {
      try {
        const o = await getOrder(d.sys, d.orderId!);
        return { key: d._id, o, state: orderState(o) };
      } catch {
        return { key: d._id, o: null, state: null };
      }
    }),
  );
  const liveMap = new Map(live.map((x) => [x.key, x]));

  return {
    row,
    memo: u.memo ?? "",
    createdAt: new Date(u.createdAt).toISOString(),
    pausedUntil: u.botPausedUntil ? new Date(u.botPausedUntil).toISOString() : null,
    cycle: u.cycle
      ? {
          at: new Date(u.cycle.at).toISOString(),
          fill: u.cycle.fill ? new Date(u.cycle.fill).toISOString() : null,
          confirm: u.cycle.confirm ? new Date(u.cycle.confirm).toISOString() : null,
          ordered: u.cycle.ordered ? new Date(u.cycle.ordered).toISOString() : null,
        }
      : null,
    stageAt: u.stageAt ? new Date(u.stageAt).toISOString() : null,
    missing: u.missing ?? "",
    nextFollowAt:
      u.interest && (u.followups ?? 0) < 2 && !row.paused && ["ask", "fill", "confirm"].includes(row.stage)
        ? new Date(
            Math.max(
              new Date(u.interest.at).getTime(),
              u.lastFollowupAt ? new Date(u.lastFollowupAt).getTime() : 0,
              u.lastMessageAt ? new Date(u.lastMessageAt).getTime() : 0,
            ) + 6 * H,
          ).toISOString()
        : null,
    draft: p
      ? {
          sys: p.sys,
          lines: linesText(p),
          total: p.quote.total,
          at: new Date(p.createdAt).toISOString(),
          data: p.data,
        }
      : null,
    orders: created.map((d) => {
      const l = liveMap.get(d._id);
      return {
        sys: d.sys,
        orderId: d.orderId!,
        at: new Date(d.orderedAt ?? d.createdAt).toISOString(),
        lines: linesText(d),
        boxes: d.quote.boxes,
        total: d.quote.total,
        state: l?.state ?? null,
        waybills: l?.o?.waybills.map((w) => w.obt) ?? [],
        notified: l?.o?.line?.notified ?? null,
      };
    }),
    messages: msgs.reverse().map((m) => ({ role: m.role, by: m.by ?? null, text: m.text, at: new Date(m.at).toISOString() })),
  };
}

/* ---------- LINE 訂單 ---------- */

export async function orderList(range: string, now = new Date()) {
  await connectDB();
  const start = range === "today" ? twDay(now) : range === "month" ? twMonth(now) : range === "season" ? twDay(now, -183) : twWeek(now);
  const days = Math.ceil((now.getTime() - start.getTime()) / DAY) + 1;
  const [{ orders, errors }, pend] = await Promise.all([ll3Orders(days <= 31 ? 31 : 184), pendingDrafts(now)]);
  const inRange = orders.filter((x) => x.at && x.at >= start);

  const uids = [...new Set([...inRange.map((x) => x.o.line?.uid).filter(Boolean), ...pend.keys()])] as string[];
  const users = new Map(
    (await LineUser.find({ _id: { $in: uids } }, { displayName: 1 }).lean<Pick<LineUserDoc, "_id" | "displayName">[]>()).map((u) => [u._id, u.displayName]),
  );

  const live = inRange.filter((x) => x.state !== "cxl");
  const boxMap = new Map<string, number>();
  for (const x of live) for (const i of x.o.items) boxMap.set(withLabel(x.sys, i.name), (boxMap.get(withLabel(x.sys, i.name)) ?? 0) + (i.qty ?? 0));
  const payMap = new Map<string, number>();
  for (const x of live) payMap.set(x.o.pay || "其他", (payMap.get(x.o.pay || "其他") ?? 0) + 1);

  const rows = [
    ...[...pend.values()].map((d) => ({
      key: `d-${d._id}`,
      sys: d.sys,
      orderId: null as number | null,
      at: new Date(d.createdAt).toISOString(),
      userId: d.userId,
      lineName: users.get(d.userId) ?? "",
      buyer: d.data.buyerName,
      recipient: d.data.recipientSame ? d.data.buyerName : d.data.recipientName ?? "",
      addr: d.data.address,
      items: linesText(d),
      boxes: d.quote.boxes,
      total: d.quote.total,
      pay: d.data.pay === "cod" ? "貨到付款" : d.data.pay === "atm" ? "匯款或ATM轉帳" : "刷卡繳費",
      state: "wait" as const,
      sub: `確認卡送出 ${Math.max(0, Math.floor((now.getTime() - new Date(d.createdAt).getTime()) / H))} 小時`,
    })),
    ...inRange.map((x) => {
      const printed = x.o.waybills.map((w) => w.printed).filter(Boolean).sort().pop();
      return {
        key: `${x.sys}-${x.o.id}`,
        sys: x.sys,
        orderId: x.o.id,
        at: x.at?.toISOString() ?? null,
        userId: x.o.line?.uid ?? null,
        lineName: users.get(x.o.line?.uid ?? "") ?? x.o.line?.name ?? "",
        buyer: x.o.buyer,
        recipient: x.o.recipient,
        addr: "",
        items: x.o.items.map((i) => `${withLabel(x.sys, i.name)} × ${i.qty ?? "?"}`).join("、"),
        boxes: x.o.boxes,
        total: x.o.total,
        pay: x.o.pay,
        state: x.state,
        sub:
          x.state === "ntf"
            ? `${x.o.line?.notified} 已傳 LINE`
            : x.state === "prt"
              ? `託運單 ${printed ?? ""} 已印 · ${x.o.waybills.length} 張`
              : x.state === "cxl"
                ? x.o.schedule
                : x.o.schedule,
      };
    }),
  ];

  const cnt = (s: string) => rows.filter((r) => r.state === s).length;
  return {
    range,
    start: start.toISOString(),
    stats: {
      orders: live.length,
      waiting: pend.size,
      boxes: live.reduce((s, x) => s + x.o.boxes, 0),
      byProduct: [...boxMap.entries()].map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v),
      amount: live.reduce((s, x) => s + x.o.total, 0),
      byPay: [...payMap.entries()].map(([name, v]) => ({ name, v })),
      toShip: cnt("ord"),
      toNotify: cnt("prt"),
    },
    counts: { all: rows.length, wait: cnt("wait"), ord: cnt("ord"), prt: cnt("prt"), ntf: cnt("ntf"), cxl: cnt("cxl") },
    rows,
    errors,
  };
}

export type OverviewData = Awaited<ReturnType<typeof overview>>;
export type CustomersData = Awaited<ReturnType<typeof customers>>;
export type CustomerDetail = NonNullable<Awaited<ReturnType<typeof customerDetail>>>;
export type OrdersData = Awaited<ReturnType<typeof orderList>>;
