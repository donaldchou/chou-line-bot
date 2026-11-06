"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { CustomersData } from "@/lib/admin-data";
import { ago, Avatar, btn, card, chip, ErrorBar, money, ProdBadge, STAGE_KEYS, STAGE_UI, StageBadge, usePoll } from "../_ui/ui";

export function CustomersView() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const stage = sp.get("stage") ?? "all";
  const sys = sp.get("sys") ?? "";
  const tag = sp.get("tag") ?? "";
  const q = sp.get("q") ?? "";
  const page = Number(sp.get("page")) || 1;
  const [text, setText] = useState(q);

  const qs = new URLSearchParams({ stage, sys, tag, q, page: String(page) });
  const { data: d, error, loading } = usePoll<CustomersData>(`/api/admin/customers?${qs}`, 30_000);

  const go = (patch: Record<string, string>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) n.set(k, v);
      else n.delete(k);
    }
    if (!("page" in patch)) n.delete("page");
    router.replace(`${path}?${n}`, { scroll: false });
  };
  const toggle = (k: string, v: string, cur: string) => go({ [k]: cur === v ? "" : v });

  return (
    <main className="px-4 pb-10 pt-5 md:px-8 md:pt-7">
      <header className="mb-4 flex flex-wrap items-center gap-4">
        <div className="mr-auto flex flex-col gap-0.5">
          <h1 className="text-[26px] font-bold">客戶</h1>
          <span className="text-sm text-mute">加過 LINE 好友的客戶共 {d?.stageCount.all ?? "…"} 位 · 依最後聯絡時間排序</span>
        </div>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: text.trim() });
          }}
          className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-field bg-white px-3.5 sm:max-w-xs"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5B665F" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input value={text} onChange={(e) => setText(e.target.value)} type="search" placeholder="LINE 名稱、訂購者姓名、電話" aria-label="找客戶" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </form>
      </header>

      <div role="group" aria-label="依進度篩選" className="mb-2.5 flex flex-wrap gap-2">
        <button type="button" className={chip(stage === "all")} aria-pressed={stage === "all"} onClick={() => go({ stage: "" })}>
          全部 {d?.stageCount.all ?? ""}
        </button>
        {STAGE_KEYS.map((s) => (
          <button key={s} type="button" className={chip(stage === s)} aria-pressed={stage === s} onClick={() => go({ stage: s })}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: stage === s && s === "shipped" ? "#fff" : STAGE_UI[s].dot }} />
            {STAGE_UI[s].name} {d?.stageCount[s] ?? 0}
          </button>
        ))}
      </div>
      <div role="group" aria-label="其他篩選" className="mb-4 flex flex-wrap gap-2">
        <button type="button" className={chip(sys === "kaki")} aria-pressed={sys === "kaki"} onClick={() => toggle("sys", "kaki", sys)}>
          甜柿
        </button>
        <button type="button" className={chip(sys === "peach")} aria-pressed={sys === "peach"} onClick={() => toggle("sys", "peach", sys)}>
          水蜜桃
        </button>
        <button type="button" className={chip(tag === "alert")} aria-pressed={tag === "alert"} onClick={() => toggle("tag", "alert", tag)}>
          需要我處理
        </button>
        <button type="button" className={chip(tag === "repeat")} aria-pressed={tag === "repeat"} onClick={() => toggle("tag", "repeat", tag)}>
          老客戶（下單 2 次以上）
        </button>
        <button type="button" className={chip(tag === "paused")} aria-pressed={tag === "paused"} onClick={() => toggle("tag", "paused", tag)}>
          真人接手中
        </button>
        {q && (
          <button type="button" className={chip(true)} onClick={() => (setText(""), go({ q: "" }))}>
            搜尋：{q} ✕
          </button>
        )}
      </div>

      <ErrorBar messages={[error]} />

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[1040px] border-collapse">
          <thead>
            <tr className="bg-[#F7F8F5] text-left text-[13px] text-ink2">
              {["客戶", "進度", "品項", "最後一則訊息", "機器人關心", "訂單／盒數", "累計金額", "最後聯絡"].map((h, i) => (
                <th key={h} scope="col" className={`whitespace-nowrap border-b border-line px-3.5 py-3 font-bold ${i === 5 || i === 6 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d?.rows.map((r) => (
              <tr key={r.id} className="border-b border-line2 text-sm hover:bg-[#FAFBF8]">
                <td className="px-3.5 py-3">
                  <Link href={`/admin/chat?u=${r.id}`} className="flex items-center gap-2.5">
                    <Avatar id={r.id} name={r.name} picture={r.picture} size={34} />
                    <span className="flex flex-col">
                      <span className="font-bold">{r.name}</span>
                      <span className="text-xs text-mute">{r.contact ? `${r.contact.name} · ${r.contact.phone}` : "尚未留資料"}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-3.5 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <StageBadge stage={r.stage} />
                    {r.alert && <span className="text-xs font-bold text-[#9E2A1C]">需要處理</span>}
                    {r.paused && <span className="text-xs font-bold text-[#8A4B00]">真人接手中</span>}
                  </div>
                </td>
                <td className="px-3.5 py-3">{r.prod ? <ProdBadge sys={r.sys} text={r.prod} /> : <span className="text-mute">—</span>}</td>
                <td className="max-w-[300px] px-3.5 py-3 text-ink2">
                  <span className="line-clamp-2">
                    {r.lastRole === "model" && <span className="text-mute">↩ </span>}
                    {r.lastText}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3.5 py-3 text-ink2">
                  {r.followups >= 2 ? "已 2 次，停止" : r.followups ? `第 ${r.followups} 次 ${ago(r.lastFollowupAt)}` : "—"}
                </td>
                <td className="whitespace-nowrap px-3.5 py-3 text-right">{r.orders ? `${r.orders} 筆／${r.boxes} 盒` : "—"}</td>
                <td className="whitespace-nowrap px-3.5 py-3 text-right font-bold">{r.amount ? money(r.amount) : "—"}</td>
                <td className="whitespace-nowrap px-3.5 py-3 text-ink2">{ago(r.lastAt)}</td>
              </tr>
            ))}
            {d && d.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3.5 py-8 text-center text-sm text-mute">
                  沒有符合的客戶
                </td>
              </tr>
            )}
            {!d && (
              <tr>
                <td colSpan={8} className="px-3.5 py-8 text-center text-sm text-mute">
                  {loading ? "載入中…" : ""}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {d && d.total > 0 && (
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 text-sm text-ink2">
          <span>
            第 {(d.page - 1) * d.per + 1}–{Math.min(d.total, d.page * d.per)} 位，共 {d.total} 位
          </span>
          <span className="flex gap-2">
            <button type="button" className={btn()} disabled={d.page <= 1} onClick={() => go({ page: String(d.page - 1) })}>
              上一頁
            </button>
            <button type="button" className={btn()} disabled={d.page * d.per >= d.total} onClick={() => go({ page: String(d.page + 1) })}>
              下一頁
            </button>
          </span>
        </div>
      )}
    </main>
  );
}
