"use client";

import { useEffect, useState } from "react";
import type { BroadcastPageData } from "@/lib/broadcast";
import type { CustomersData } from "@/lib/admin-data";
import { SEGMENTS } from "@/lib/segments";
import { Icon } from "../_ui/icons";
import { call, errMsg, inputCls, PageHeader, useCodeGate } from "../_ui/kit";
import { useCanEdit } from "../_ui/me";
import { btn, card, ErrorBar, mdhm, SYS_LABEL, usePoll } from "../_ui/ui";

const SEG_OPTS = [...SEGMENTS.map((s) => ({ key: s.key as string, name: s.name, rule: s.rule })), { key: "all", name: "全部好友", rule: "所有沒有封鎖官方帳號的 LINE 好友" }];
const segName = (k: string) => SEG_OPTS.find((s) => s.key === k)?.name ?? k;

const STATUS: Record<string, { name: string; bg: string; fg: string }> = {
  scheduled: { name: "已排定", bg: "#FFF1DC", fg: "#8A4B00" },
  sending: { name: "傳送中", bg: "#E3ECF7", fg: "#1D4E8F" },
  sent: { name: "已傳出", bg: "#DFF2E7", fg: "#17613E" },
  failed: { name: "失敗", bg: "#FDE2DE", fg: "#9E2A1C" },
  cancelled: { name: "已取消", bg: "#ECEDEB", fg: "#4F5A53" },
};

/** 台灣時間「明天 10:00」當預設排程時間（datetime-local 用） */
function defaultWhen() {
  const t = new Date(Date.now() + 8 * 3600_000 + 86400_000);
  return `${t.toISOString().slice(0, 10)}T10:00`;
}

export default function PushPage() {
  const { data: d, error, reload } = usePoll<BroadcastPageData>("/api/admin/push", 60_000);
  const canEdit = useCanEdit();
  const gate = useCodeGate();
  const [segs, setSegs] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [cards, setCards] = useState<string[]>([]);
  const [orderButton, setOrderButton] = useState(true);
  const [mode, setMode] = useState<"now" | "schedule">("schedule");
  // 預設「明天 10:00」：掛上後才算（伺服器預先產生畫面時不能讀現在時間）
  const [when, setWhen] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setWhen((w) => w || defaultWhen()), 0);
    return () => clearTimeout(t);
  }, []);
  const [preview, setPreview] = useState<{ key: string; count: number; total: number; excluded: number } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState("");

  const segKey = [...segs].sort().join(",");
  useEffect(() => {
    if (!segKey) return;
    call<{ count: number; total: number; excluded: number }>("/api/admin/push", { method: "POST", json: { action: "preview", segs: segKey.split(",") } }).then(
      (r) => setPreview({ key: segKey, ...r }),
      () => setPreview(null),
    );
  }, [segKey]);
  const pv = segKey && preview?.key === segKey ? preview : null;

  const toggle = (list: string[], k: string) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
  const content = { segs, text, cards, orderButton };
  // datetime-local 是台灣時間（使用者在台灣），轉成 ISO 帶 +08:00
  const whenIso = mode === "now" ? "now" : `${when}:00+08:00`;
  const ready = !!segs.length && !!text.trim() && (mode === "now" || !!when);

  const send = () =>
    gate.ask({
      title: mode === "now" ? "馬上群發" : "排定群發",
      confirmLabel: mode === "now" ? "確認傳送" : "確認排定",
      danger: true,
      message: (
        <>
          會傳給 <b>{pv?.count ?? "…"}</b> 位客人（{segs.map(segName).join("、")}），用掉 <b>{pv?.count ?? "…"}</b> 則 LINE 訊息
          {mode === "schedule" && <>，時間 {when.replace("T", " ")}</>}。送出後不能收回。
        </>
      ),
      submit: async (code) => {
        try {
          const r = await call<{ status: string; sent: number }>("/api/admin/push", { method: "POST", json: { action: "send", ...content, when: whenIso }, code });
          setMsg({ ok: true, text: r.status === "scheduled" ? "已排定群發" : r.status === "sent" ? `已傳給 ${r.sent} 位客人` : "群發失敗，請看下方紀錄" });
          if (r.status !== "failed") {
            setText("");
            setSegs([]);
          }
          await reload();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: errMsg(e) };
        }
      },
    });

  const cancel = async (id: string) => {
    if (!confirm("取消這筆排定的群發？")) return;
    setBusy(id);
    try {
      await call("/api/admin/push", { method: "POST", json: { action: "cancel", id } });
      await reload();
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy("");
    }
  };

  const q = d?.quota;
  const left = q && q.limit !== null ? Math.max(0, q.limit - q.used) : null;

  return (
    <main className="px-4 pb-10 pt-5 md:px-8 md:pt-7">
      <PageHeader title="群發訊息" desc={`開季通知、回購提醒：選分群 → 寫訊息 → 確認人數與則數 → 送出。${d?.gapDays ?? 7} 天內收過群發的客人會自動排除，避免打擾。`} />
      <ErrorBar messages={[error]} />
      {msg && (
        <p role="status" className={`mb-4 rounded-xl px-4 py-3 text-sm ${msg.ok ? "bg-[#DFF2E7] text-[#17613E]" : "bg-[#FDECEA] text-[#9E2A1C]"}`}>
          {msg.text}
        </p>
      )}

      {canEdit ? (
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
            <section aria-labelledby="s1" className={`${card} flex flex-col gap-3 px-5 py-4`}>
              <h2 id="s1" className="text-[17px] font-bold">
                1. 傳給誰
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {SEG_OPTS.map((s) => {
                  const on = segs.includes(s.key);
                  return (
                    <button
                      key={s.key}
                      type="button"
                      aria-pressed={on}
                      title={s.rule}
                      onClick={() => setSegs(toggle(segs, s.key))}
                      className={`flex min-h-[52px] items-center gap-2.5 rounded-[10px] px-3.5 text-left text-sm ${on ? "border-2 border-leaf bg-[#EEF7F1]" : "border border-field bg-white hover:bg-ground"}`}
                    >
                      <span className={`flex h-[18px] w-[18px] items-center justify-center rounded text-xs text-white ${on ? "bg-leaf" : "border-2 border-[#9AA39D]"}`}>{on ? "✓" : ""}</span>
                      <span className={`flex-1 ${on ? "font-bold" : ""}`}>{s.name}</span>
                      <span className="text-mute">{d?.sizes[s.key as keyof typeof d.sizes] ?? "…"} 位</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[13px] text-ink2">選好幾群時，同一位客人只傳一次。已封鎖、{d?.gapDays ?? 7} 天內收過群發的客人會自動排除。</p>
            </section>

            <section aria-labelledby="s2" className={`${card} flex flex-col gap-3 px-5 py-4`}>
              <h2 id="s2" className="text-[17px] font-bold">
                2. 訊息內容
              </h2>
              <label className="flex flex-col gap-1.5 text-sm font-bold">
                文字
                <textarea
                  rows={4}
                  maxLength={1000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="例：您好！拉拉山周家農場今年的甜柿開始接受預訂了，想訂購直接在這裡回覆就可以喔！"
                  className={`${inputCls} py-2.5 font-normal leading-relaxed`}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold">附上</span>
                {Object.entries(SYS_LABEL).map(([k, v]) => (
                  <label key={k} className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-field px-3 text-sm">
                    <input type="checkbox" checked={cards.includes(k)} onChange={() => setCards(toggle(cards, k))} />
                    {v}產品卡片
                  </label>
                ))}
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-field px-3 text-sm">
                  <input type="checkbox" checked={orderButton} onChange={(e) => setOrderButton(e.target.checked)} />
                  「我要訂購」按鈕
                </label>
              </div>
              <p className="text-[13px] text-ink2">文字和卡片一起傳，每位客人算 1 則訊息。客人回覆後由機器人接手。</p>
            </section>

            <section aria-labelledby="s3" className={`${card} flex flex-col gap-3 px-5 py-4`}>
              <h2 id="s3" className="text-[17px] font-bold">
                3. 什麼時候傳
              </h2>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="inline-flex min-h-11 items-center gap-1.5">
                  <input type="radio" name="when" checked={mode === "now"} onChange={() => setMode("now")} />
                  馬上傳
                </label>
                <label className="inline-flex min-h-11 items-center gap-1.5">
                  <input type="radio" name="when" checked={mode === "schedule"} onChange={() => setMode("schedule")} />
                  排定時間
                </label>
                <input
                  type="datetime-local"
                  value={when}
                  disabled={mode !== "schedule"}
                  onChange={(e) => setWhen(e.target.value)}
                  aria-label="排定傳送時間"
                  className={`${inputCls} w-auto`}
                />
                <span className="text-[13px] text-mute">只能 09:00～21:00；排定的群發會在時間到後 15 分鐘內傳出</span>
              </div>
            </section>

            <section aria-label="送出" className="flex flex-wrap items-center gap-4 rounded-xl bg-forest px-5 py-4 text-white">
              <div className="mr-auto flex flex-col gap-0.5">
                <span className="text-[15px]">
                  {segs.length ? (
                    <>
                      會傳給 <b className="text-[22px]">{pv?.count ?? "…"}</b> 位客人，用掉 <b className="text-[22px]">{pv?.count ?? "…"}</b> 則訊息
                    </>
                  ) : (
                    "先選要傳給哪些分群"
                  )}
                </span>
                <span className="text-[13px] text-[#A9C4B6]">
                  {pv && pv.excluded > 0 && `已排除 ${pv.excluded} 位 ${d?.gapDays ?? 7} 天內收過群發的客人 · `}
                  本月剩餘額度 {q ? (left === null ? "不限" : `${left} 則（已用 ${q.used}／${q.limit}）`) : "查不到（LINE 還沒設定）"} · 送出需要輸入後台驗證碼
                </span>
              </div>
              <TestSend content={content} disabled={!text.trim()} onResult={setMsg} />
              <button type="button" disabled={!ready || !!busy} onClick={send} className="min-h-11 rounded-[10px] bg-linegreen px-5 text-sm font-bold text-white hover:bg-[#05b14c] disabled:opacity-50">
                {mode === "now" ? "馬上群發" : "排定群發"}
              </button>
            </section>
          </div>

          <aside aria-labelledby="pv" className="flex flex-[1_1_300px] flex-col gap-2.5">
            <h2 id="pv" className="text-[15px] font-bold">
              客人手機上看到的樣子
            </h2>
            <div className="w-[300px] max-w-full overflow-hidden rounded-[28px] border-8 border-ink bg-chatbg">
              <div className="border-b border-line bg-white px-3.5 py-3 text-sm font-bold">周家農場</div>
              <div className="flex min-h-[380px] flex-col gap-2.5 p-3.5">
                <div className="max-w-[92%] whitespace-pre-wrap rounded-[14px_14px_14px_4px] bg-white px-3 py-2.5 text-[13px] leading-relaxed">{text || "（訊息文字）"}</div>
                {cards.map((k) => (
                  <div key={k} className="w-[200px] overflow-hidden rounded-[14px] bg-white">
                    <div className="flex h-24 items-center justify-center bg-[#F1DDC6] text-xs text-[#8F4708]">{SYS_LABEL[k]}產品照片</div>
                    <div className="px-3 py-2 text-[13px]">
                      <b>{SYS_LABEL[k]}產品卡片</b>
                      <div className="text-xs text-ink2">各規格與價格（可左右滑）</div>
                    </div>
                  </div>
                ))}
                {orderButton && (
                  <div className="mt-auto flex flex-wrap gap-1.5">
                    {["我要訂購", "看產品照片"].map((l) => (
                      <span key={l} className="rounded-full border border-[#06C755] bg-white px-3 py-1 text-xs font-bold text-[#06A047]">
                        {l}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <p className={`${card} mb-5 px-5 py-4 text-sm text-mute`}>一般使用者只能看群發紀錄，群發請由管理者操作。</p>
      )}

      <section aria-labelledby="hist" className={`${card} mt-5 overflow-x-auto`}>
        <h2 id="hist" className="px-5 pb-1 pt-4 text-[17px] font-bold">
          群發紀錄
        </h2>
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-[13px] text-mute">
              {["時間", "對象", "內容", "狀態", "傳出", "7 天內回覆", "7 天內下單", ""].map((h) => (
                <th key={h} className="whitespace-nowrap px-5 py-2.5 font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d?.history.map((h) => (
              <tr key={h.id} className="border-t border-line2">
                <td className="whitespace-nowrap px-5 py-3">{mdhm(h.sentAt ?? h.scheduledAt)}</td>
                <td className="px-5 py-3">{h.segs.map(segName).join("、")}</td>
                <td className="max-w-[280px] px-5 py-3 text-ink2">
                  <span className="line-clamp-2">{h.text}</span>
                  {h.cards.length > 0 && <span className="text-xs text-mute">附 {h.cards.map((c) => SYS_LABEL[c]).join("、")}卡片</span>}
                </td>
                <td className="px-5 py-3">
                  <span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: STATUS[h.status]?.bg, color: STATUS[h.status]?.fg }}>
                    {STATUS[h.status]?.name ?? h.status}
                  </span>
                  {h.error && <div className="mt-1 max-w-[200px] text-xs text-[#9E2A1C]">{h.error}</div>}
                </td>
                <td className="whitespace-nowrap px-5 py-3">
                  {h.status === "sent" || h.status === "failed" ? `${h.sent} 位${h.failed ? `（失敗 ${h.failed}）` : ""}` : "—"}
                </td>
                <td className="whitespace-nowrap px-5 py-3">{h.replied === null ? "—" : `${h.replied} 位（${h.sent ? Math.round((h.replied / h.sent) * 100) : 0}%）`}</td>
                <td className="whitespace-nowrap px-5 py-3">{h.ordered === null ? "—" : `${h.ordered} 位 · ${h.boxes} 盒`}</td>
                <td className="whitespace-nowrap px-5 py-3 text-right">
                  {h.status === "scheduled" && canEdit && (
                    <button type="button" className={btn()} disabled={busy === h.id} onClick={() => cancel(h.id)}>
                      取消
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {d && !d.history.length && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-mute">
                  還沒有群發紀錄
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      {gate.dialog}
    </main>
  );
}

/** 先傳給一位 LINE 好友（通常是自己）看看 */
function TestSend({
  content,
  disabled,
  onResult,
}: {
  content: { segs: string[]; text: string; cards: string[]; orderButton: boolean };
  disabled: boolean;
  onResult: (m: { ok: boolean; text: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const { data } = usePoll<CustomersData>(open && search ? `/api/admin/customers?q=${encodeURIComponent(search)}` : null, 600_000);

  const test = async (userId: string, name: string) => {
    setBusy(true);
    try {
      await call("/api/admin/push", { method: "POST", json: { action: "test", ...content, userId } });
      onResult({ ok: true, text: `已傳給 ${name} 測試（用掉 1 則訊息，不算群發）` });
      setOpen(false);
    } catch (e) {
      onResult({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open} className="min-h-11 rounded-[10px] border border-[#CFE0D6] px-4 text-sm font-bold text-white hover:bg-forest2 disabled:opacity-50">
        先傳給自己測試
      </button>
      {open && (
        <div className="absolute bottom-14 right-0 z-10 flex w-80 flex-col gap-2 rounded-xl border border-line bg-white p-3 text-ink shadow-lg">
          <p className="text-[13px] text-ink2">選一位 LINE 好友（先用自己的 LINE 加官方帳號好友，再搜尋自己的名稱）</p>
          <form
            role="search"
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q.trim());
            }}
          >
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="LINE 名稱、姓名、電話" aria-label="找測試對象" className={inputCls} />
            <button type="submit" className={btn()} aria-label="搜尋">
              <Icon name="search" size={16} />
            </button>
          </form>
          <div className="flex max-h-56 flex-col overflow-y-auto">
            {data?.rows.map((r) => (
              <button key={r.id} type="button" disabled={busy} onClick={() => test(r.id, r.name)} className="min-h-11 rounded-lg px-2.5 text-left text-sm hover:bg-ground">
                <b>{r.name}</b> <span className="text-xs text-mute">{r.contact ? `${r.contact.name} · ${r.contact.phone}` : ""}</span>
              </button>
            ))}
            {search && data && !data.rows.length && <p className="px-2.5 py-2 text-sm text-mute">找不到</p>}
          </div>
        </div>
      )}
    </div>
  );
}
