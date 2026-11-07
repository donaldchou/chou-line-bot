"use client";

import Link from "next/link";
import { useState } from "react";
import type { OverviewData } from "@/lib/admin-data";
import { ago, ALERT_UI, Avatar, Badge, card, ErrorBar, money, ProdBadge, STAGE_UI, usePoll, type Stage } from "./_ui/ui";

const chatHref = (id: string | null) => (id ? `/admin/chat?u=${id}` : "/admin/orders");

export default function OverviewPage() {
  const { data: d, error, loading } = usePoll<OverviewData>("/api/admin/overview", 60_000);
  const [q, setQ] = useState("");

  const today = d && new Date(d.now).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", weekday: "short" });

  return (
    <main className="px-4 pb-10 pt-5 md:px-8 md:pt-7">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <div className="mr-auto flex flex-col gap-0.5">
          <h1 className="text-[26px] font-bold">今天的客戶進度</h1>
          <span className="text-sm text-mute">
            {today}
            {d?.shop.map((s) => ` · ${s.label}${s.open === null ? "連不上" : s.open ? "接單中" : "已停止接單"}`)}
          </span>
        </div>
        <form action="/admin/customers" className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-field bg-white px-3.5 sm:max-w-xs" role="search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5B665F" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input name="q" value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="找客戶：LINE 名稱、姓名、電話" aria-label="找客戶" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </form>
        <span className="inline-flex h-9 items-center gap-2 rounded-full bg-[#DFF2E7] px-3.5 text-[13px] font-bold text-[#17613E]">
          <span className="h-2 w-2 rounded-full bg-[#17A05B]" />
          機器人自動回覆中{d?.kpi.paused ? ` · ${d.kpi.paused} 位真人接手` : ""}
        </span>
      </header>

      <ErrorBar messages={[error, ...(d?.errors ?? [])]} />
      {!d && !error && <p className="text-mute">{loading ? "載入中…" : ""}</p>}

      {d && (
        <>
          <section aria-label="今日數字" className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
            <Kpi label="今天傳訊息的客戶" value={d.kpi.todayUsers} unit="位" sub={`新加好友 ${d.kpi.newFriends} 位`} />
            <Kpi label="詢問中／填資料中" value={d.kpi.open} unit="位" sub="還沒下單" />
            <Kpi label="確認卡等客人按" value={d.kpi.confirm} unit="筆" sub={d.kpi.confirm ? `最久 ${d.kpi.oldestConfirmH} 小時` : "沒有"} />
            <Kpi label="今天結單" value={d.kpi.todayOrders} unit="筆" sub={`共 ${d.kpi.todayBoxes} 盒 · ${money(d.kpi.todayAmount)}`} />
            <Kpi label="已寄出、待通知" value={d.kpi.toNotify} unit="筆" sub="到訂單頁按「LINE 通知」" href="/admin/orders" />
          </section>

          <section aria-labelledby="att" className={`${card} mb-6 px-5 py-4`}>
            <div className="mb-2 flex flex-wrap items-baseline gap-2.5">
              <h2 id="att" className="text-lg font-bold">
                需要你處理 {d.alerts.length > 0 && <span className="text-[#9E2A1C]">{d.alerts.length}</span>}
              </h2>
              <span className="text-[13px] text-mute">機器人處理不了，或卡住太久的客戶</span>
            </div>
            {d.alerts.length === 0 && <p className="border-t border-line2 py-3 text-sm text-mute">目前沒有需要處理的客戶。</p>}
            {d.alerts.map((a, i) => (
              <Link
                key={i}
                href={chatHref(a.userId)}
                className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1 border-t border-line2 px-1 py-2 hover:bg-[#FAFBF8]"
              >
                <Badge bg={ALERT_UI[a.kind].bg} fg={ALERT_UI[a.kind].fg}>
                  {ALERT_UI[a.kind].name}
                </Badge>
                <span className="text-[15px] font-bold">{a.name}</span>
                <span className="min-w-0 flex-[1_1_280px] text-sm text-ink2">{a.text}</span>
                <span className="text-[13px] text-mute">{ago(a.at)}</span>
                <span className="text-sm font-bold text-leaf">查看 ›</span>
              </Link>
            ))}
          </section>

          <section aria-labelledby="pipe" className="mb-6">
            <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
              <h2 id="pipe" className="text-lg font-bold">
                客戶進度看板
              </h2>
              <span className="text-[13px] text-mute">近 7 天有傳訊息的客戶，由左到右越接近成交</span>
            </div>
            <div className="overflow-x-auto pb-1.5">
              <div className="grid min-w-[1180px] grid-cols-6 gap-3">
                {d.cols.map((c) => (
                  <div key={c.key} className="flex flex-col gap-2 rounded-xl bg-[#EAEDE7] p-2.5">
                    <div className="flex items-center gap-2 px-1 pt-0.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: STAGE_UI[c.key as Stage].dot }} />
                      <span className="text-sm font-bold">{c.name}</span>
                      <Link href={`/admin/customers?stage=${c.key}`} className="ml-auto text-[13px] font-bold text-ink2 hover:underline">
                        {c.count}
                      </Link>
                    </div>
                    <span className="px-1 text-xs text-ink2">{c.hint}</span>
                    {c.items.map((p) => (
                      <Link key={p.id} href={chatHref(p.id)} className={`${card} flex flex-col gap-1.5 px-3 py-2.5 hover:border-[#C5CCC3]`}>
                        <div className="flex items-center gap-2">
                          <Avatar id={p.id} name={p.name} picture={p.picture} size={28} />
                          <span className="truncate text-sm font-bold">{p.name}</span>
                          <span className="ml-auto flex-none text-xs text-mute">{ago(p.lastAt)}</span>
                        </div>
                        <span className="line-clamp-2 text-[13px] leading-snug text-ink2">{p.lastText || "（沒有訊息）"}</span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {p.prod && <ProdBadge sys={p.sys} text={p.prod} />}
                          {p.extra && <span className="text-xs text-ink2">{p.extra}</span>}
                          {p.paused && <span className="text-xs font-bold text-[#8A4B00]">真人接手中</span>}
                        </div>
                      </Link>
                    ))}
                    {c.count > c.items.length && (
                      <Link href={`/admin/customers?stage=${c.key}`} className="px-1 py-1 text-center text-[13px] font-bold text-leaf">
                        還有 {c.count - c.items.length} 位 ›
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-3.5 lg:grid-cols-2">
            <div className={`${card} px-5 py-4`}>
              <h2 className="mb-1 text-lg font-bold">本週 LINE 訂購數量</h2>
              <p className="mb-3.5 text-[13px] text-mute">客人在 LINE 確認下單的盒數，依品項</p>
              {d.bars.length === 0 && <p className="text-sm text-mute">本週還沒有訂單。</p>}
              <Bars rows={d.bars.map((b) => ({ name: b.name, v: b.v, unit: "盒" }))} color="#1E6B47" />
            </div>
            <div className={`${card} px-5 py-4`}>
              <h2 className="mb-1 text-lg font-bold">本週詢問 → 結單</h2>
              <p className="mb-3.5 text-[13px] text-mute">這週開始詢問的客戶，走到每一步的人數</p>
              <Bars rows={d.funnel.map((f) => ({ name: f.name, v: f.v, unit: "人" }))} color="#3F7FBF" />
              <p className="mt-3 text-[13px] text-ink2">
                本週成交率 <b>{d.funnel[0].v ? Math.round((d.funnel[3].v / d.funnel[0].v) * 100) : 0}%</b> · 機器人關心後才下單的有 <b>{d.afterFollow}</b> 人
              </p>
            </div>
          </section>

          {d.bot && <BotSection b={d.bot} />}
        </>
      )}
    </main>
  );
}

function Kpi({ label, value, unit, sub, href }: { label: string; value: number; unit: string; sub: string; href?: string }) {
  const body = (
    <>
      <span className="text-[13px] text-mute">{label}</span>
      <span className="text-[30px] font-bold leading-tight">
        {value}
        <span className="ml-1 text-sm font-normal text-mute">{unit}</span>
      </span>
      <span className="text-xs text-mute">{sub}</span>
    </>
  );
  const cls = `${card} flex flex-col gap-1 px-4 py-4`;
  return href ? (
    <Link href={href} className={`${cls} hover:border-[#C5CCC3]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

type Bot = NonNullable<OverviewData["bot"]>;

/** 機器人表現（近 7 天） */
function BotSection({ b }: { b: Bot }) {
  const max = Math.max(1, ...b.days.map((x) => x.v));
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
  return (
    <section aria-labelledby="bot" className="mt-6 flex flex-col gap-3.5">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 id="bot" className="text-lg font-bold">
          機器人表現
        </h2>
        <span className="text-[13px] text-mute">近 7 天（含今天）</span>
      </div>
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Kpi label="客人訊息" value={b.messages} unit="則" sub={`${b.talkers} 位客人 · 平均每天 ${Math.round(b.messages / 7)} 則`} />
        <Kpi label="機器人自己回完" value={b.selfSolved ?? 0} unit="%" sub={b.selfSolved === null ? "還沒有對話" : "沒有轉給真人的客人"} />
        <Kpi label="轉給真人" value={b.handoffs} unit="次" sub={`${b.handoffUsers} 位客人 · 佔 ${pct(b.handoffUsers, b.talkers)}`} />
        <Kpi label="詢問 → 結單" value={b.asked ? Math.round((b.ordered / b.asked) * 100) : 0} unit="%" sub={`${b.asked} 位開始詢問，${b.ordered} 位下單`} />
      </div>
      <div className="grid gap-3.5 lg:grid-cols-2">
        <div className={`${card} px-5 py-4`}>
          <h3 className="text-[17px] font-bold">每天對話數</h3>
          <p className="mb-3 text-[13px] text-mute">客人傳來的訊息則數</p>
          <div className="flex h-[180px] items-end gap-2.5 border-b border-field" role="img" aria-label={`近 7 天每天對話數：${b.days.map((x) => `${x.label} ${x.v} 則`).join("、")}`}>
            {b.days.map((x) => (
              <div key={x.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${x.label}：${x.v} 則`}>
                <span className="text-xs font-bold">{x.v}</span>
                <div className="w-full max-w-11 rounded-t bg-leaf" style={{ height: `${(x.v / max) * 140}px` }} />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2.5">
            {b.days.map((x) => (
              <span key={x.label} className="flex-1 text-center text-xs text-mute">
                {x.label}
              </span>
            ))}
          </div>
        </div>
        <div className={`${card} px-5 py-4`}>
          <h3 className="text-[17px] font-bold">轉給真人的原因</h3>
          <p className="mb-3 text-[13px] text-mute">每一次「需要你處理」都會記錄，按「已處理」或真人回覆後也會留著</p>
          <Bars
            rows={[
              { name: "機器人答不出來", v: b.reasons.unanswered, unit: "次" },
              { name: "想找真人", v: b.reasons.human, unit: "次" },
              { name: "確認卡 3 小時沒按", v: b.reasons.confirm, unit: "次" },
            ]}
            color="#C2621B"
          />
          <p className="mt-3 text-[13px] text-ink2">
            {b.avgMin === null ? "還沒有處理完的紀錄" : <>平均 <b>{b.avgMin < 60 ? `${b.avgMin} 分鐘` : `${Math.round(b.avgMin / 6) / 10} 小時`}</b> 內處理</>}
            {b.open > 0 && <> · 還有 <b className="text-[#9E2A1C]">{b.open}</b> 件沒處理</>}
          </p>
        </div>
      </div>
    </section>
  );
}

function Bars({ rows, color }: { rows: { name: string; v: number; unit: string }[]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className="flex flex-col">
      {rows.map((r) => (
        <div key={r.name} className="grid min-h-[34px] grid-cols-[minmax(90px,140px)_1fr_64px] items-center gap-2.5" title={`${r.name}：${r.v} ${r.unit}`}>
          <span className="truncate text-sm">{r.name}</span>
          <div className="h-3.5 rounded bg-line2">
            <div className="h-3.5 rounded-r" style={{ width: `${(r.v / max) * 100}%`, background: color }} />
          </div>
          <span className="text-right text-sm font-bold">
            {r.v} {r.unit}
          </span>
        </div>
      ))}
    </div>
  );
}
