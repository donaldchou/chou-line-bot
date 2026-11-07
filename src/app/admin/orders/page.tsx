"use client";

import Link from "next/link";
import { useState } from "react";
import type { OrdersData } from "@/lib/admin-data";
import { api, Badge, btn, card, chip, ErrorBar, mdhm, money, SYS_LABEL, usePoll } from "../_ui/ui";
import { useCanEdit } from "../_ui/me";

const RANGES = [
  { k: "today", n: "今天" },
  { k: "week", n: "本週" },
  { k: "month", n: "本月" },
  { k: "season", n: "近 6 個月" },
];
const STATE: Record<string, { name: string; bg: string; fg: string }> = {
  wait: { name: "等客人確認", bg: "#EFE8FA", fg: "#5B3A9A" },
  ord: { name: "已下單", bg: "#DFF2E7", fg: "#17613E" },
  prt: { name: "已寄出、待通知", bg: "#FFF1DC", fg: "#8A4B00" },
  ntf: { name: "已通知", bg: "#14342A", fg: "#FFFFFF" },
  cxl: { name: "已取消", bg: "#ECEDEB", fg: "#4F5A53" },
};

export default function OrdersPage() {
  const [range, setRange] = useState("week");
  const [filter, setFilter] = useState("all");
  const { data: d, error, loading, reload } = usePoll<OrdersData>(`/api/admin/orders?range=${range}`, 60_000);
  const [busyRaw, setBusy] = useState("");
  // 一般使用者只能看：通知、提醒按鈕停用
  const busy = useCanEdit() ? busyRaw : "readonly";
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = d?.rows.filter((r) => filter === "all" || r.state === filter) ?? [];

  const notify = async (sys: string, orderId: number) => {
    if (!confirm(`傳 LINE 寄出通知（含託運單照片）給 ${SYS_LABEL[sys]} No.${orderId} 的客人？`)) return;
    setBusy(`${sys}-${orderId}`);
    setMsg(null);
    try {
      const r = await api<{ waybills: number; images: number }>("/api/admin/orders", { json: { sys, orderId } });
      setMsg({ ok: true, text: `已通知 No.${orderId}：託運單 ${r.waybills} 張、照片 ${r.images} 張` });
      await reload();
    } catch (e) {
      setMsg({ ok: false, text: `No.${orderId} 通知失敗：${e instanceof Error ? e.message : e}` });
    } finally {
      setBusy("");
    }
  };
  const remind = async (userId: string) => {
    if (!confirm("重新傳確認卡給客人，提醒他按「確認下單」？（會用掉 LINE 訊息則數）")) return;
    setBusy(userId);
    setMsg(null);
    try {
      await api(`/api/admin/customers/${userId}`, { json: { action: "remind" } });
      setMsg({ ok: true, text: "已重新傳確認卡" });
    } catch (e) {
      setMsg({ ok: false, text: `提醒失敗：${e instanceof Error ? e.message : e}` });
    } finally {
      setBusy("");
    }
  };

  const s = d?.stats;
  return (
    <main className="px-4 pb-10 pt-5 md:px-8 md:pt-7">
      <header className="mb-5 flex flex-wrap items-center gap-4">
        <div className="mr-auto flex flex-col gap-0.5">
          <h1 className="text-[26px] font-bold">LINE 訂單</h1>
          <span className="text-sm text-mute">客人在 LINE 按「確認下單」建立的訂單，狀態即時讀取 ll3 訂單系統</span>
        </div>
        <div role="group" aria-label="期間" className="flex flex-wrap gap-1.5">
          {RANGES.map((r) => (
            <button key={r.k} type="button" className={chip(range === r.k)} aria-pressed={range === r.k} onClick={() => setRange(r.k)}>
              {r.n}
            </button>
          ))}
        </div>
      </header>

      <ErrorBar messages={[error, ...(d?.errors ?? [])]} />
      {msg && (
        <div role="status" className={`mb-4 rounded-xl px-4 py-3 text-sm ${msg.ok ? "bg-[#DFF2E7] text-[#17613E]" : "bg-[#FDECEA] text-[#9E2A1C]"}`}>
          {msg.text}
        </div>
      )}

      {s && (
        <section aria-label="統計" className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <Stat label="結單" value={`${s.orders}`} unit="筆" sub={`另有 ${s.waiting} 筆等客人確認`} />
          <Stat label="訂購盒數" value={`${s.boxes}`} unit="盒" sub={s.byProduct.map((p) => `${p.name} ${p.v}`).join(" · ") || "—"} />
          <Stat label="金額" value={money(s.amount)} sub={s.byPay.map((p) => `${p.name} ${p.v} 筆`).join(" · ") || "—"} />
          <Stat label="待出貨／待通知" value={`${s.toShip} / ${s.toNotify}`} sub={`已印託運單但還沒傳 LINE 的有 ${s.toNotify} 筆`} />
        </section>
      )}

      <div role="group" aria-label="依狀態篩選" className="mb-3.5 flex flex-wrap gap-2">
        <button type="button" className={chip(filter === "all")} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          全部 {d?.counts.all ?? ""}
        </button>
        {Object.entries(STATE).map(([k, v]) => (
          <button key={k} type="button" className={chip(filter === k)} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {v.name} {d?.counts[k as keyof OrdersData["counts"]] ?? ""}
          </button>
        ))}
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[1060px] border-collapse">
          <thead>
            <tr className="bg-[#F7F8F5] text-left text-[13px] text-ink2">
              {["訂單", "LINE 客戶", "訂購者 → 收件者", "品項與數量", "金額", "付款", "狀態", "動作"].map((h) => (
                <th key={h} scope="col" className={`whitespace-nowrap border-b border-line px-3.5 py-3 font-bold ${h === "金額" ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-line2 align-middle text-sm">
                <td className="whitespace-nowrap px-3.5 py-3">
                  <b>{r.orderId ? `${SYS_LABEL[r.sys]} No.${r.orderId}` : "（尚未建立）"}</b>
                  <br />
                  <span className="text-xs text-mute">{mdhm(r.at)}</span>
                </td>
                <td className="whitespace-nowrap px-3.5 py-3">
                  {r.userId ? (
                    <Link href={`/admin/chat?u=${r.userId}`} className="font-bold text-leaf hover:underline">
                      {r.lineName || "客人"}
                    </Link>
                  ) : (
                    r.lineName
                  )}
                </td>
                <td className="px-3.5 py-3 text-ink2">
                  {r.buyer}
                  {r.recipient && r.recipient !== r.buyer ? ` → ${r.recipient}` : ""}
                </td>
                <td className="px-3.5 py-3">
                  {r.items}
                  <br />
                  <span className="text-xs text-mute">{r.boxes} 盒</span>
                </td>
                <td className="whitespace-nowrap px-3.5 py-3 text-right font-bold">{money(r.total)}</td>
                <td className="whitespace-nowrap px-3.5 py-3">{r.pay}</td>
                <td className="px-3.5 py-3">
                  <Badge bg={STATE[r.state].bg} fg={STATE[r.state].fg}>
                    {STATE[r.state].name}
                  </Badge>
                  <br />
                  <span className="text-xs text-mute">{r.sub}</span>
                </td>
                <td className="whitespace-nowrap px-3.5 py-3">
                  <div className="flex gap-2">
                    {r.state === "prt" && r.orderId && (
                      <button type="button" className={btn("line")} disabled={!!busy} onClick={() => notify(r.sys, r.orderId!)}>
                        {busy === `${r.sys}-${r.orderId}` ? "傳送中…" : "LINE 通知寄出"}
                      </button>
                    )}
                    {r.state === "wait" && r.userId && (
                      <button type="button" className={btn()} disabled={!!busy} onClick={() => remind(r.userId!)}>
                        提醒客人確認
                      </button>
                    )}
                    {r.userId && (
                      <Link href={`/admin/chat?u=${r.userId}`} className={btn()}>
                        對話
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {d && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3.5 py-8 text-center text-sm text-mute">
                  這段期間沒有訂單
                </td>
              </tr>
            )}
            {!d && (
              <tr>
                <td colSpan={8} className="px-3.5 py-8 text-center text-sm text-mute">
                  {loading || !error ? "載入中…（要向 ll3 訂單系統讀取，可能要幾秒）" : ""}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Stat({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub: string }) {
  return (
    <div className={`${card} flex flex-col gap-1 px-4 py-4`}>
      <span className="text-[13px] text-mute">{label}</span>
      <span className="text-[28px] font-bold leading-tight">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-mute">{unit}</span>}
      </span>
      <span className="text-xs text-mute">{sub}</span>
    </div>
  );
}
