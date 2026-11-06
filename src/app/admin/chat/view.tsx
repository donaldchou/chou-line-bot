"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import type { CustomerDetail, CustomersData } from "@/lib/admin-data";
import {
  ago,
  ALERT_UI,
  api,
  Avatar,
  Badge,
  btn,
  clock,
  dayLabel,
  ErrorBar,
  mdhm,
  money,
  sameDay,
  STAGE_UI,
  StageBadge,
  SYS_LABEL,
  usePoll,
  type Stage,
} from "../_ui/ui";

export function ChatView() {
  const sp = useSearchParams();
  const uid = sp.get("u");
  return (
    <main className="flex min-h-0 flex-1 flex-col md:h-dvh md:flex-row">
      <div className={`${uid ? "hidden lg:flex" : "flex"} min-h-0 w-full flex-col border-r border-line bg-white lg:w-[300px] lg:flex-none`}>
        <Threads current={uid} />
      </div>
      {uid ? (
        <Detail key={uid} id={uid} />
      ) : (
        <div className="hidden flex-1 items-center justify-center text-mute lg:flex">從左邊選一位客戶，查看對話內容</div>
      )}
    </main>
  );
}

/* ---------- 對話列表 ---------- */

function Threads({ current }: { current: string | null }) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const { data, error } = usePoll<CustomersData>(`/api/admin/customers?q=${encodeURIComponent(search)}`, 15_000);
  return (
    <section aria-label="對話列表" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2.5 px-4 pb-3 pt-4">
        <h1 className="text-xl font-bold">對話</h1>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
          }}
          className="flex h-10 items-center gap-2 rounded-[10px] bg-ground px-3"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5B665F" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="搜尋客戶、姓名、電話" aria-label="搜尋對話" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </form>
      </div>
      {error && <p className="px-4 text-sm text-[#9E2A1C]">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {data?.rows.map((t) => (
          <Link
            key={t.id}
            href={`/admin/chat?u=${t.id}`}
            aria-current={t.id === current ? "page" : undefined}
            className={`flex gap-2.5 border-t border-[#F0F2EE] px-4 py-3 ${t.id === current ? "bg-[#EEF6F1]" : "hover:bg-[#FAFBF8]"}`}
          >
            <Avatar id={t.id} name={t.name} picture={t.picture} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-1.5">
                <b className="truncate text-sm">{t.name}</b>
                <span className="ml-auto flex-none text-xs text-mute">{ago(t.lastAt)}</span>
              </span>
              <span className="truncate text-[13px] text-ink2">
                {t.lastRole === "model" && <span className="text-mute">↩ </span>}
                {t.lastText}
              </span>
              <span className="flex flex-wrap gap-1">
                {t.alert ? (
                  <Badge bg={ALERT_UI[t.alert.kind]?.bg ?? "#FDE2DE"} fg={ALERT_UI[t.alert.kind]?.fg ?? "#9E2A1C"} small>
                    需要處理
                  </Badge>
                ) : null}
                <StageBadge stage={t.stage} small />
                {t.paused && (
                  <Badge bg="#FFF1DC" fg="#8A4B00" small>
                    真人接手
                  </Badge>
                )}
              </span>
            </span>
          </Link>
        ))}
        {data && data.rows.length === 0 && <p className="px-4 py-6 text-sm text-mute">沒有符合的客戶</p>}
      </div>
    </section>
  );
}

/* ---------- 單一客戶 ---------- */

function Detail({ id }: { id: string }) {
  const { data: d, error, reload } = usePoll<CustomerDetail>(`/api/admin/customers/${id}`, 8_000);
  const [tab, setTab] = useState<"chat" | "info">("chat");
  const [busy, setBusy] = useState("");
  const [actErr, setActErr] = useState("");

  const act = async (action: string, extra: Record<string, unknown> = {}, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return false;
    setBusy(action);
    setActErr("");
    try {
      await api(`/api/admin/customers/${id}`, { json: { action, ...extra } });
      await reload();
      return true;
    } catch (e) {
      setActErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy("");
    }
  };

  if (!d)
    return (
      <div className="flex flex-1 flex-col p-6">
        <Link href="/admin/chat" className="mb-3 text-sm font-bold text-leaf lg:hidden">
          ‹ 對話列表
        </Link>
        {error ? <ErrorBar messages={[error]} /> : <p className="text-mute">載入中…</p>}
      </div>
    );

  const r = d.row;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col xl:flex-row">
      <section aria-label={`與${r.name}的對話`} className={`${tab === "chat" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col bg-chatbg xl:flex`}>
        <header className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-4 py-3 md:px-5">
          <Link href="/admin/chat" aria-label="返回對話列表" className="flex h-11 w-8 items-center lg:hidden">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </Link>
          <Avatar id={r.id} name={r.name} picture={r.picture} />
          <div className="mr-auto flex min-w-0 flex-col">
            <b className="truncate text-base">{r.name}</b>
            <span className="text-xs text-mute">LINE 好友 · {mdhm(d.createdAt)} 加入</span>
          </div>
          {r.paused ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#8A4B00]">
                <span className="h-2 w-2 rounded-full bg-[#D08A1E]" />
                真人接手中（{clock(d.pausedUntil)} 自動恢復）
              </span>
              <button type="button" className={btn()} disabled={!!busy} onClick={() => act("pause", { on: false })}>
                恢復機器人
              </button>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#17613E]">
                <span className="h-2 w-2 rounded-full bg-[#17A05B]" />
                機器人回覆中
              </span>
              <button type="button" className={btn()} disabled={!!busy} onClick={() => act("pause", { on: true })}>
                我來回覆（暫停機器人）
              </button>
            </>
          )}
          <button type="button" className={`${btn()} xl:hidden`} onClick={() => setTab("info")}>
            資料與訂單
          </button>
        </header>
        <MobileProgress d={d} onInfo={() => setTab("info")} />
        <Messages d={d} />
        <Composer busy={busy} error={actErr} blocked={false} onSend={(text) => act("reply", { text })} onProducts={(sys) => act("products", { sys })} />
      </section>

      <aside
        aria-label="客戶資料與訂單"
        className={`${tab === "info" ? "flex" : "hidden"} min-h-0 w-full flex-col gap-5 overflow-y-auto border-l border-line bg-white p-5 xl:flex xl:w-[360px] xl:flex-none`}
      >
        <button type="button" className={`${btn()} self-start xl:hidden`} onClick={() => setTab("chat")}>
          ‹ 回到聊天
        </button>
        {actErr && tab === "info" && <ErrorBar messages={[actErr]} />}
        <Info d={d} busy={busy} act={act} />
      </aside>
    </div>
  );
}

/* ---------- 聊天內容 ---------- */

const isNote = (l: string) => /^\[.*\]$/.test(l.trim());

function Messages({ d }: { d: CustomerDetail }) {
  const box = useRef<HTMLDivElement>(null);
  const n = d.messages.length;
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [n]);

  return (
    <div ref={box} className="flex min-h-[300px] flex-1 flex-col gap-3 overflow-y-auto px-4 py-5 md:px-5">
      {n === 0 && <p className="text-center text-sm text-mute">還沒有訊息</p>}
      {d.messages.length >= 300 && <p className="text-center text-xs text-mute">只顯示最近 300 則</p>}
      {d.messages.map((m, i) => {
        const lines = m.text.split("\n");
        const text = lines.filter((l) => !isNote(l)).join("\n").trim();
        const notes = lines.filter(isNote).map((l) => l.trim().slice(1, -1));
        const mine = m.role === "model";
        const who = m.role === "user" ? "客人" : m.by === "admin" ? "農場" : "機器人";
        const newDay = i === 0 || !sameDay(d.messages[i - 1].at, m.at);
        return (
          <Fragment key={i}>
            {newDay && <div className="self-center rounded-[10px] bg-[#D8DFE5] px-2.5 py-0.5 text-xs text-ink2">{dayLabel(m.at)}</div>}
            {text && (
              <div className={`flex max-w-[78%] flex-col gap-1 ${mine ? "items-end self-end" : "items-start"}`}>
                <span className="text-xs text-ink2">
                  {who} · {clock(m.at)}
                </span>
                <div
                  className={`whitespace-pre-wrap break-words px-3.5 py-2.5 text-sm leading-relaxed ${
                    !mine ? "rounded-[4px_16px_16px_16px] bg-white" : m.by === "admin" ? "rounded-[16px_4px_16px_16px] bg-[#FFE7B8]" : "rounded-[16px_4px_16px_16px] bg-[#C9F2D9]"
                  }`}
                >
                  {text}
                </div>
              </div>
            )}
            {notes.map((t, j) => (
              <div key={j} className={`flex max-w-[78%] flex-col gap-1 ${mine ? "items-end self-end" : "items-start"}`}>
                {!text && (
                  <span className="text-xs text-ink2">
                    {who} · {clock(m.at)}
                  </span>
                )}
                <div className="rounded-[10px] bg-[#EFE8FA] px-3 py-1.5 text-[13px] text-[#4A2F80]">{t}</div>
              </div>
            ))}
          </Fragment>
        );
      })}
      {d.nextFollowAt && (
        <div className="self-center rounded-[10px] bg-[#EFE8FA] px-3 py-1.5 text-[13px] text-[#5B3A9A]">
          已關心 {d.row.followups} 次 · 下次自動關心 {mdhm(d.nextFollowAt)}（09:00～21:00 才傳）
        </div>
      )}
    </div>
  );
}

function Composer({
  busy,
  error,
  onSend,
  onProducts,
}: {
  busy: string;
  error: string;
  blocked: boolean;
  onSend: (t: string) => Promise<boolean>;
  onProducts: (sys: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await onSend(text)) setText("");
  };
  return (
    <form onSubmit={send} aria-label="以農場身分回覆" className="flex flex-col gap-2 border-t border-line bg-white px-4 py-3 md:px-5">
      <label htmlFor="reply" className="text-xs text-mute">
        以「周家農場」身分傳訊息給客人（會用掉 LINE 訊息則數；傳送後機器人暫停 12 小時）
      </label>
      {error && (
        <p role="alert" className="text-sm text-[#9E2A1C]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2.5">
        <textarea
          id="reply"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(e);
          }}
          placeholder="輸入訊息…（Ctrl＋Enter 傳送）"
          className="min-h-11 min-w-0 flex-[1_1_240px] resize-y rounded-[10px] border border-field px-3.5 py-2.5 text-sm"
        />
        <div className="relative">
          <button type="button" className={btn()} aria-expanded={menu} onClick={() => setMenu(!menu)} disabled={!!busy}>
            附產品卡片
          </button>
          {menu && (
            <div className="absolute bottom-12 right-0 z-10 flex w-40 flex-col rounded-xl border border-line bg-white p-1.5 shadow-lg">
              {Object.entries(SYS_LABEL).map(([k, v]) => (
                <button
                  key={k}
                  type="button"
                  className="min-h-11 rounded-lg px-3 text-left text-sm hover:bg-ground"
                  onClick={async () => {
                    setMenu(false);
                    if (confirm(`傳${v}的產品卡片給客人？`)) await onProducts(k);
                  }}
                >
                  {v}產品卡片
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="submit" className={btn("pri")} disabled={!!busy || !text.trim()}>
          {busy === "reply" ? "傳送中…" : "傳送"}
        </button>
      </div>
    </form>
  );
}

/* ---------- 進度與資料 ---------- */

function steps(d: CustomerDetail) {
  const s = d.row.stage;
  const c = d.cycle;
  const order: Stage[] = ["ask", "fill", "confirm", "ordered", "shipped"];
  const cur = s === "lost" ? -1 : order.indexOf(s);
  const last = d.orders[0];
  const list = [
    { key: "ask", name: "詢問", at: c?.at ?? null, sub: SYS_LABEL[d.row.sys ?? ""] ? `問${SYS_LABEL[d.row.sys ?? ""]}` : "" },
    { key: "fill", name: "填寫資料", at: c?.fill ?? null, sub: s === "fill" && d.missing ? `還缺：${d.missing}` : "" },
    { key: "confirm", name: "等客人確認", at: c?.confirm ?? null, sub: d.draft ? `確認卡 ${money(d.draft.total)}` : "" },
    { key: "ordered", name: "結單（建立訂單）", at: c?.ordered ?? null, sub: last && cur >= 3 ? `${SYS_LABEL[last.sys]} No.${last.orderId}` : "客人按「確認下單」後" },
    { key: "shipped", name: "寄出通知", at: s === "shipped" ? d.stageAt : null, sub: s === "shipped" ? "已傳寄出通知與託運單" : "印託運單後在訂單頁按通知" },
  ];
  return list.map((x, i) => ({ ...x, state: i < cur ? "done" : i === cur ? "now" : "todo" }));
}

function MobileProgress({ d, onInfo }: { d: CustomerDetail; onInfo: () => void }) {
  const st = steps(d);
  return (
    <div className="flex flex-col gap-2 border-b border-line bg-white px-4 pb-3 pt-2.5 xl:hidden">
      {d.row.stage === "lost" ? (
        <StageBadge stage="lost" />
      ) : (
        <>
          <div className="grid grid-cols-5 gap-1" aria-label={`進度：${STAGE_UI[d.row.stage].name}`}>
            {st.map((x) => (
              <span key={x.key} className="h-1.5 rounded" style={{ background: x.state === "done" ? "#1E9E5F" : x.state === "now" ? STAGE_UI[d.row.stage].dot : "#DDE1DC" }} />
            ))}
          </div>
          <div className="flex justify-between text-[11px] text-ink2">
            {["詢問", "填資料", "等確認", "結單", "寄出"].map((n, i) => (
              <span key={n} className={st[i].state === "now" ? "font-bold text-ink" : ""}>
                {n}
              </span>
            ))}
          </div>
        </>
      )}
      {d.draft && (
        <button type="button" onClick={onInfo} className="flex items-center gap-2.5 rounded-[10px] border border-dashed border-[#B9A6E0] bg-[#F8F5FD] px-3 py-2 text-left text-[13px]">
          <span className="flex-1">
            {d.draft.lines} · <b>{money(d.draft.total)}</b>
          </span>
          <span className="font-bold text-leaf">資料與訂單 ›</span>
        </button>
      )}
    </div>
  );
}

const DELIVERY: Record<string, string> = { AM: "早上 08～12 點", FM: "中午 12～18 點", NIGHT: "晚上 18～22 點" };
const PAY: Record<string, string> = { cod: "貨到付款", atm: "匯款或 ATM 轉帳", card: "刷卡繳費" };
const ORDER_STATE: Record<string, { name: string; bg: string; fg: string }> = {
  ord: { name: "已下單", bg: "#DFF2E7", fg: "#17613E" },
  prt: { name: "已寄出、待通知", bg: "#FFF1DC", fg: "#8A4B00" },
  ntf: { name: "已通知", bg: "#14342A", fg: "#FFFFFF" },
  cxl: { name: "已取消", bg: "#ECEDEB", fg: "#4F5A53" },
};

function Info({ d, busy, act }: { d: CustomerDetail; busy: string; act: (a: string, x?: Record<string, unknown>, c?: string) => Promise<boolean> }) {
  const r = d.row;
  const [memo, setMemo] = useState(d.memo);
  const [saved, setSaved] = useState(false);
  const st = steps(d);
  const data = d.draft?.data;

  return (
    <>
      {r.alert && (
        <div className="rounded-xl border border-[#F2C4BC] bg-[#FDECEA] p-3.5 text-sm">
          <div className="mb-1 flex items-center gap-2">
            <Badge bg={ALERT_UI[r.alert.kind]?.bg ?? "#FDE2DE"} fg={ALERT_UI[r.alert.kind]?.fg ?? "#9E2A1C"}>
              {ALERT_UI[r.alert.kind]?.name ?? "需要處理"}
            </Badge>
            <span className="text-xs text-mute">{ago(r.alert.at)}</span>
          </div>
          <p className="mb-2.5 text-ink">{r.alert.text}</p>
          <button type="button" className={btn()} disabled={!!busy} onClick={() => act("resolve")}>
            已處理
          </button>
        </div>
      )}

      <section>
        <h3 className="mb-2.5 text-sm font-bold text-ink2">目前進度</h3>
        {r.stage === "lost" && (
          <p className="mb-2 text-sm">
            <StageBadge stage="lost" /> <span className="text-ink2">關心 {r.followups} 次後仍沒下單</span>
          </p>
        )}
        <ol className="flex flex-col">
          {st.map((x, i) => (
            <li key={x.key} className="flex min-h-11 gap-3">
              <span className="flex flex-col items-center">
                <span
                  className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 text-xs font-bold text-white"
                  style={{
                    borderColor: x.state === "done" ? "#1E9E5F" : x.state === "now" ? STAGE_UI[r.stage].dot : "#C9CFC9",
                    background: x.state === "done" ? "#1E9E5F" : x.state === "now" ? STAGE_UI[r.stage].dot : "#fff",
                  }}
                  aria-hidden="true"
                >
                  {x.state === "done" ? "✓" : x.state === "now" ? "•" : ""}
                </span>
                {i < st.length - 1 && <span className="w-0.5 flex-1 bg-line" />}
              </span>
              <span className="flex flex-col pb-2">
                <b className="text-sm" style={{ color: x.state === "todo" ? "#5B665F" : x.state === "now" ? STAGE_UI[r.stage].fg === "#FFFFFF" ? "#14342A" : STAGE_UI[r.stage].fg : "#1B211D" }}>
                  {x.name}
                  {x.state === "now" && <span className="sr-only">（目前）</span>}
                </b>
                <span className="text-xs text-mute">{[x.at ? mdhm(x.at) : "", x.sub].filter(Boolean).join(" · ")}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className="mb-2.5 text-sm font-bold text-ink2">訂購者／收件者{data ? "（確認卡上的資料）" : ""}</h3>
        {data ? (
          <dl className="grid grid-cols-[64px_1fr] gap-x-2.5 gap-y-1 text-sm">
            <dt className="text-mute">訂購者</dt>
            <dd>
              {data.buyerName} · {data.buyerPhone}
            </dd>
            <dt className="text-mute">收件者</dt>
            <dd>{data.recipientSame ? "同訂購者" : `${data.recipientName} · ${data.recipientPhone}`}</dd>
            <dt className="text-mute">地址</dt>
            <dd>{data.address}</dd>
            <dt className="text-mute">送達</dt>
            <dd>{DELIVERY[data.delivery]}</dd>
            <dt className="text-mute">付款</dt>
            <dd>{PAY[data.pay]}</dd>
            {data.memo && (
              <>
                <dt className="text-mute">備註</dt>
                <dd>{data.memo}</dd>
              </>
            )}
          </dl>
        ) : r.contact ? (
          <p className="text-sm">
            {r.contact.name} · {r.contact.phone}
          </p>
        ) : (
          <p className="text-sm text-mute">客人還沒留資料</p>
        )}
      </section>

      <section>
        <h3 className="mb-2.5 text-sm font-bold text-ink2">訂單紀錄</h3>
        <div className="flex flex-col gap-2">
          {d.draft && (
            <div className="rounded-[10px] border border-dashed border-[#B9A6E0] bg-[#F8F5FD] px-3 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <b>待確認</b>
                <span className="ml-auto">
                  <StageBadge stage="confirm" />
                </span>
              </div>
              <div className="text-ink2">
                {d.draft.lines} · {money(d.draft.total)}
              </div>
              <div className="text-xs text-mute">確認卡 {mdhm(d.draft.at)} 送出</div>
              <button
                type="button"
                className={`${btn()} mt-2`}
                disabled={!!busy}
                onClick={() => act("remind", {}, "重新傳確認卡給客人，提醒他按「確認下單」？（會用掉 LINE 訊息則數）")}
              >
                提醒客人確認
              </button>
            </div>
          )}
          {d.orders.map((o) => (
            <div key={`${o.sys}${o.orderId}`} className="rounded-[10px] border border-line px-3 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <b>
                  {SYS_LABEL[o.sys]} No.{o.orderId}
                </b>
                <span className="ml-auto">
                  {o.state ? (
                    <Badge bg={ORDER_STATE[o.state].bg} fg={ORDER_STATE[o.state].fg}>
                      {ORDER_STATE[o.state].name}
                    </Badge>
                  ) : (
                    <span className="text-xs text-mute">狀態查不到</span>
                  )}
                </span>
              </div>
              <div className="text-ink2">
                {mdhm(o.at)} · {o.lines} · {money(o.total)}
              </div>
              {o.waybills.length > 0 && (
                <div className="text-xs text-ink2">
                  黑貓 {o.waybills.join("、")}
                  {o.notified ? ` · ${o.notified} 已傳寄出通知` : ""}
                </div>
              )}
            </div>
          ))}
          {!d.draft && d.orders.length === 0 && <p className="text-sm text-mute">還沒有訂單</p>}
        </div>
        {r.orders > 0 && (
          <p className="mt-2.5 text-[13px] text-ink2">
            累計 {r.orders} 筆 · {r.boxes} 盒 · {money(r.amount)}
          </p>
        )}
      </section>

      <section>
        <h3 className="mb-2.5 text-sm font-bold text-ink2">
          <label htmlFor="memo">農場備註（客人看不到）</label>
        </h3>
        <textarea
          id="memo"
          rows={3}
          value={memo}
          onChange={(e) => (setMemo(e.target.value), setSaved(false))}
          placeholder="例：老客戶，送禮用，要附卡片"
          className="w-full resize-y rounded-[10px] border border-field px-3 py-2.5 text-sm"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            className={btn()}
            disabled={!!busy || memo === d.memo}
            onClick={async () => {
              if (await act("memo", { text: memo })) setSaved(true);
            }}
          >
            儲存備註
          </button>
          {saved && <span className="text-sm text-[#17613E]">已儲存</span>}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btn()}
          disabled={!!busy || r.followups >= 2}
          onClick={() => act("stopFollow", {}, "之後不再自動傳關心訊息給這位客人？")}
        >
          {r.followups >= 2 ? "已停止關心" : "停止關心"}
        </button>
        <button
          type="button"
          className={btn()}
          disabled={!!busy || r.stage === "lost"}
          onClick={() => act("markLost", {}, "標記為「沒有下單」？等待確認的確認卡也會作廢。")}
        >
          標記：沒有下單
        </button>
      </div>
    </>
  );
}
