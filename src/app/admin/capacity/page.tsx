"use client";

import { useState } from "react";
import type { CapacityData, CapStatus } from "@/lib/capacity";
import { call, errMsg, inputCls, PageHeader, UnlockTimer, useCodeGate } from "../_ui/kit";
import { useCanEdit } from "../_ui/me";
import { btn, card, ErrorBar, money, usePoll } from "../_ui/ui";

const OPTS: { key: CapStatus; name: string; bg: string }[] = [
  { key: "open", name: "接單中", bg: "#1E6B47" },
  { key: "full", name: "本週額滿", bg: "#B86A00" },
  { key: "stop", name: "停止接單", bg: "#4F5A53" },
];

export default function CapacityPage() {
  const { data: d, error, reload } = usePoll<CapacityData>("/api/admin/capacity", 60_000);
  const canEdit = useCanEdit();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const gate = useCodeGate();

  // 每個修改都要驗證碼（後台解鎖期間不用再輸入）
  const save = (key: string, json: unknown, what = "接單設定") =>
    gate.ask({
      title: `修改${what}`,
      confirmLabel: "確認修改",
      message: `修改${what}需要驗證碼。`,
      submit: async (code) => {
        setBusy(key);
        setErr("");
        try {
          await call("/api/admin/capacity", { method: "POST", json, code });
          await reload();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: errMsg(e) };
        } finally {
          setBusy("");
        }
      },
    });

  const week = d ? new Date(d.weekStart).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric" }) : "";

  return (
    <main className="px-4 pb-10 pt-5 md:px-8 md:pt-7">
      <PageHeader title="接單設定" badge={<UnlockTimer />} desc="貨不夠或出貨排不下時在這裡切換；機器人會照設定回覆客人，不再收這個規格的單。上限只算 LINE 訂單，網站訂單不算。" />
      <ErrorBar messages={[error, err]} />
      {!d && !error && <p className="text-mute">載入中…</p>}

      {d && (
        <div className="flex flex-col gap-5">
          <section aria-label="網站接單狀態" className="grid gap-3.5 sm:grid-cols-2">
            {d.systems.map((s) => (
              <div key={s.sys} className={`${card} flex items-center gap-2.5 px-4 py-3.5`}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.open ? "#17A05B" : "#9AA39D" }} />
                <span className="text-[15px]">
                  <b>{s.label}</b>網站（ll3）{s.open === null ? "連不上" : s.open ? "接單中" : "已停止接單"}
                </span>
                <span className="ml-auto text-xs text-mute">網站停止接單時，LINE 也一律不收單</span>
              </div>
            ))}
          </section>

          {d.systems.map((s) => (
            <section key={s.sys} aria-labelledby={`cap-${s.sys}`} className={`${card} overflow-x-auto`}>
              <h2 id={`cap-${s.sys}`} className="px-5 pb-1 pt-4 text-lg font-bold">
                {s.label}
              </h2>
              {s.error && <p className="px-5 text-sm text-[#9E2A1C]">讀不到商品：{s.error}</p>}
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[13px] text-mute">
                    <th className="px-5 py-2.5 font-bold">規格</th>
                    <th className="px-5 py-2.5 font-bold">LINE 接單</th>
                    <th className="px-5 py-2.5 font-bold">本週（{week} 起）已訂／上限</th>
                  </tr>
                </thead>
                <tbody>
                  {s.products.map((p) => {
                    const key = `${s.sys}:${p.id}`;
                    const pct = p.cap ? Math.min(100, Math.round((p.sold / p.cap) * 100)) : 0;
                    return (
                      <tr key={p.id} className="border-t border-line2">
                        <td className="px-5 py-3">
                          <b className="block">{p.name}</b>
                          <span className="text-xs text-mute">
                            {p.id} · {money(p.price)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <div role="group" aria-label={`${p.name} 接單狀態`} className="inline-flex overflow-hidden rounded-[10px] border border-field">
                            {OPTS.map((o) => {
                              const on = p.status === o.key;
                              return (
                                <button
                                  key={o.key}
                                  type="button"
                                  aria-pressed={on}
                                  disabled={!canEdit || !!busy}
                                  onClick={() => !on && save(key, { sys: s.sys, productId: p.id, status: o.key })}
                                  className={`min-h-10 px-3.5 text-[13px] disabled:cursor-default ${on ? "font-bold text-white" : "bg-white text-ink2 hover:bg-ground"}`}
                                  style={on ? { background: o.bg } : undefined}
                                >
                                  {o.name}
                                </button>
                              );
                            })}
                          </div>
                          {p.status === "open" && p.effective === "full" && <p className="mt-1 text-xs font-bold text-[#8A4B00]">已達上限，自動變成本週額滿</p>}
                        </td>
                        <td className="px-5 py-3">
                          <CapInput
                            key={`${key}-${p.cap}`}
                            sold={p.sold}
                            cap={p.cap}
                            disabled={!canEdit || !!busy}
                            label={`${p.name} 每週上限盒數`}
                            onSave={(cap) => save(key, { sys: s.sys, productId: p.id, cap })}
                          />
                          {p.cap !== null && (
                            <div className="mt-1.5 h-1.5 w-40 rounded bg-line2">
                              <div className="h-1.5 rounded" style={{ width: `${pct}%`, background: pct >= 100 ? "#B86A00" : "#1E6B47" }} />
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="border-t border-line2 px-5 py-3 text-[13px] text-ink2">上限留空＝不限；達到上限會自動變成「本週額滿」，每週一 00:00 重新計算。</p>
            </section>
          ))}

          <Replies key={`${d.replies.full}|${d.replies.stop}`} replies={d.replies} disabled={!canEdit || !!busy} onSave={(replies) => save("replies", { replies }, "機器人回覆")} />
          <Guard key={JSON.stringify(d.guard)} guard={d.guard} disabled={!canEdit || !!busy} onSave={(guard) => save("guard", { guard }, "防止惡意訂購設定")} />
        </div>
      )}
      {gate.dialog}
    </main>
  );
}

function CapInput({ sold, cap, disabled, label, onSave }: { sold: number; cap: number | null; disabled: boolean; label: string; onSave: (cap: number | null) => void }) {
  const [v, setV] = useState(cap === null ? "" : String(cap));
  const changed = v !== (cap === null ? "" : String(cap));
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v.trim() === "" ? null : Number(v));
      }}
    >
      <b>{sold}</b>
      <span className="text-mute">/</span>
      <input type="number" min={0} value={v} placeholder="不限" aria-label={label} disabled={disabled} onChange={(e) => setV(e.target.value)} className={`${inputCls} w-20!`} />
      <span className="text-mute">盒</span>
      {changed && (
        <button type="submit" disabled={disabled} className={btn("pri")}>
          儲存
        </button>
      )}
    </form>
  );
}

type GuardData = CapacityData["guard"];
const GUARD_FIELDS: { key: keyof GuardData; title: string; before: string; unit: string; hint: string }[] = [
  { key: "maxPerDay", title: "① 每人下單筆數上限", before: "同一個 LINE 帳號 24 小時內最多", unit: "筆", hint: "超過時機器人請客人來電，並通知你。" },
  { key: "bigBoxes", title: "② 大量訂單：盒數", before: "一筆訂單超過", unit: "盒", hint: "先不傳確認卡，通知你到對話頁核准。" },
  { key: "bigCod", title: "② 大量訂單：貨到付款金額", before: "貨到付款金額超過", unit: "元", hint: "同上，避免有人亂訂後拒收。匯款、刷卡不受影響。" },
  { key: "msgPerMin", title: "⑤ 防洗訊息", before: "同一人 1 分鐘內超過", unit: "則", hint: "機器人提醒一次後暫停回覆 1 分鐘，並通知你，避免被刷 AI 費用。" },
];

/** 防止惡意訂購的參數（0＝不限／關閉）；③ 禁止下單在對話頁的客戶資料裡設定 */
function Guard({ guard, disabled, onSave }: { guard: GuardData; disabled: boolean; onSave: (g: GuardData) => void }) {
  const [g, setG] = useState<Record<keyof GuardData, string>>(
    () => Object.fromEntries(Object.entries(guard).map(([k, v]) => [k, String(v)])) as Record<keyof GuardData, string>,
  );
  const changed = GUARD_FIELDS.some((f) => g[f.key] !== String(guard[f.key]));
  const valid = GUARD_FIELDS.every((f) => /^\d+$/.test(g[f.key].trim()));
  return (
    <section aria-labelledby="guard" className={`${card} flex flex-col gap-3 px-5 py-4`}>
      <h2 id="guard" className="text-lg font-bold">
        防止惡意訂購
      </h2>
      <p className="-mt-2 text-[13px] text-mute">填 0＝不限制（關閉這項）。③ 禁止下單：到「對話」頁打開客人的資料，按「禁止下單」。</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {GUARD_FIELDS.map((f) => (
          <div key={f.key} className="rounded-xl border border-line p-3.5">
            <div className="mb-2 text-sm font-bold">{f.title}</div>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              {f.before}
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={g[f.key]}
                disabled={disabled}
                onChange={(e) => setG({ ...g, [f.key]: e.target.value })}
                className={`${inputCls} ${f.key === "bigCod" ? "w-28!" : "w-20!"}`}
              />
              {f.unit}
              {g[f.key].trim() === "0" && <span className="rounded-full bg-[#ECEDEB] px-2 py-0.5 text-xs font-bold text-[#4F5A53]">已關閉</span>}
            </label>
            <p className="mt-1.5 text-xs text-mute">{f.hint}</p>
          </div>
        ))}
      </div>
      {changed && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={btn()}
            onClick={() => setG(Object.fromEntries(Object.entries(guard).map(([k, v]) => [k, String(v)])) as Record<keyof GuardData, string>)}
          >
            取消
          </button>
          <button
            type="button"
            className={btn("pri")}
            disabled={disabled || !valid}
            onClick={() => onSave(Object.fromEntries(GUARD_FIELDS.map((f) => [f.key, Number(g[f.key])])) as GuardData)}
          >
            儲存設定
          </button>
          {!valid && <span className="text-sm text-[#9E2A1C]">請填 0 以上的整數</span>}
        </div>
      )}
    </section>
  );
}

function Replies({ replies, disabled, onSave }: { replies: CapacityData["replies"]; disabled: boolean; onSave: (r: CapacityData["replies"]) => void }) {
  const [r, setR] = useState(replies);
  const changed = r.full !== replies.full || r.stop !== replies.stop;
  return (
    <section aria-labelledby="rep" className={`${card} flex flex-col gap-3 px-5 py-4`}>
      <h2 id="rep" className="text-lg font-bold">
        機器人怎麼回客人
      </h2>
      <p className="-mt-2 text-[13px] text-mute">客人問到或想訂額滿／停止接單的規格時，機器人會照這段話的意思回覆，並推薦其他接單中的規格。</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-bold">
          本週額滿時
          <textarea rows={3} value={r.full} disabled={disabled} onChange={(e) => setR({ ...r, full: e.target.value })} className={`${inputCls} py-2 font-normal`} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold">
          停止接單時
          <textarea rows={3} value={r.stop} disabled={disabled} onChange={(e) => setR({ ...r, stop: e.target.value })} className={`${inputCls} py-2 font-normal`} />
        </label>
      </div>
      {changed && (
        <div className="flex gap-2">
          <button type="button" className={btn()} onClick={() => setR(replies)}>
            取消
          </button>
          <button type="button" className={btn("pri")} disabled={disabled} onClick={() => onSave(r)}>
            儲存回覆
          </button>
        </div>
      )}
    </section>
  );
}
