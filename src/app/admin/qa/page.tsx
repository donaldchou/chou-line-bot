"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CatView, QaPageData, QaView, UnansweredView } from "@/lib/qa";
import { Icon } from "../_ui/icons";
import { call, errMsg, Field, inputCls, Modal, PageHeader, smallBtn, Tabs } from "../_ui/kit";
import { useCanEdit } from "../_ui/me";
import { ago, btn, card, ErrorBar, usePoll } from "../_ui/ui";

type Data = QaPageData & { fixed: string[] };

/** 分類標籤顏色：前三個沿用通用／甜柿／水蜜桃的顏色，之後輪流 */
const CAT_COLORS = [
  { bg: "#E6F0F8", fg: "#1E5A8A" },
  { bg: "#FDF0DC", fg: "#8A4B00" },
  { bg: "#FBE8F0", fg: "#9C2F5C" },
  { bg: "#E5F3EA", fg: "#1E6B47" },
  { bg: "#EFE8FA", fg: "#5B3A9A" },
  { bg: "#F1EDE4", fg: "#6B5320" },
];

type Editing = { item?: QaView; alert?: UnansweredView };

export default function QaPage() {
  const { data: d, error, reload } = usePoll<Data>("/api/admin/qa", 60_000);
  const canEdit = useCanEdit();
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [unTab, setUnTab] = useState<"pending" | "done">("pending");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  const colorOf = useMemo(() => {
    const m = new Map<string, (typeof CAT_COLORS)[number]>();
    d?.categories.forEach((c, i) => m.set(c.id, CAT_COLORS[i % CAT_COLORS.length]));
    return m;
  }, [d]);
  const catName = (id: string) => d?.categories.find((c) => c.id === id)?.name ?? "（沒有分類）";

  const shown = useMemo(() => {
    if (!d) return [];
    const kw = q.trim().toLowerCase();
    return d.items.filter((i) => (cat === "all" || i.cat === cat) && (!kw || `${i.q} ${i.alt} ${i.a}`.toLowerCase().includes(kw)));
  }, [d, cat, q]);

  const pending = d?.unanswered.filter((u) => !u.qaId) ?? [];
  const done = d?.unanswered.filter((u) => u.qaId) ?? [];

  const act = async (key: string, json: unknown) => {
    setBusy(key);
    setErr("");
    setMsg("");
    try {
      await call("/api/admin/qa", { method: "POST", json });
      await reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="px-4 pb-10 pt-5 md:px-8 md:pt-7">
      <PageHeader
        title="問答管理"
        desc="機器人回答客人時會參考這裡的問答，存檔後立刻生效。價格、運費、手續費、能不能訂由系統自動處理，不在這裡改。"
      >
        {canEdit && (
          <button type="button" className={btn("pri")} onClick={() => setEditing({})} disabled={!d}>
            <Icon name="plus" size={18} /> 新增問答
          </button>
        )}
      </PageHeader>
      <ErrorBar messages={[error, err]} />
      {msg && (
        <div role="status" className="mb-4 rounded-xl border border-[#B7DEC6] bg-[#EEF7F1] px-4 py-3 text-sm text-[#17613E]">
          {msg}
        </div>
      )}
      {!d && !error && <p className="text-mute">載入中…</p>}

      {d && (
        <div className="flex flex-col gap-5">
          {/* 機器人答不出來的問題 */}
          <section aria-labelledby="unans" className="flex flex-col gap-2.5 rounded-xl border border-[#F0D9A8] bg-[#FFF8EA] px-4 py-4 md:px-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 id="unans" className="text-[17px] font-bold text-[#6B3E00]">
                機器人答不出來的問題
              </h2>
              {pending.length > 0 && <span className="rounded-full bg-[#B86A00] px-2.5 py-0.5 text-[13px] font-bold text-white">{pending.length} 則待處理</span>}
              <div className="ml-auto flex gap-1 rounded-[10px] bg-[#F6E6C4] p-[3px]" role="group" aria-label="答不出來的問題">
                {(
                  [
                    ["pending", `待處理 ${pending.length}`],
                    ["done", `已加入問答 ${done.length}`],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={unTab === k}
                    onClick={() => setUnTab(k)}
                    className={`min-h-9 rounded-lg px-3 text-[13px] text-[#6B3E00] ${unTab === k ? "bg-white font-bold" : ""}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[13px] text-[#6B3E00]">
              {unTab === "pending"
                ? "按「加入問答」補上答案，之後同樣的問題機器人就會回答。每則都會保留，加入問答後移到「已加入問答」。"
                : "已經補上答案的問題，可以看當初客人怎麼問、對應到哪一則問答。"}
            </p>
            {(unTab === "pending" ? pending : done).length === 0 && (
              <p className="rounded-lg bg-white px-3.5 py-3 text-sm text-mute">{unTab === "pending" ? "目前沒有待處理的問題。" : "還沒有加入過問答。"}</p>
            )}
            {(unTab === "pending" ? pending : done).slice(0, 50).map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-[#F0E2C4] bg-white px-3.5 py-3">
                <div className="min-w-0 flex-[1_1_320px]">
                  <div className="text-[15px] font-bold">{u.question ? `「${u.question}」` : u.reason}</div>
                  {u.question && u.reason && <div className="mt-0.5 text-[13px] text-ink2">機器人記下：{u.reason}</div>}
                  <div className="mt-0.5 text-[13px] text-mute">
                    {u.name} · {ago(u.at)} · <Link href={`/admin/chat?u=${encodeURIComponent(u.userId)}`} className="text-leaf underline">看對話</Link>
                    {!u.qaId && u.handled && " · 已在對話中處理過"}
                  </div>
                  {u.qaId && (
                    <div className="mt-1 text-[13px] text-[#17613E]">
                      → 已加入問答：<b>{u.qaQ}</b>（{ago(u.qaAt)}）
                    </div>
                  )}
                </div>
                {!u.qaId && canEdit && (
                  <button type="button" className={btn("pri")} onClick={() => setEditing({ alert: u })}>
                    加入問答
                  </button>
                )}
              </div>
            ))}
          </section>

          {/* 分類、搜尋 */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 max-w-full">
              <Tabs
                value={cat}
                onChange={setCat}
                tabs={[{ value: "all", label: `全部 ${d.items.length}` }, ...d.categories.map((c) => ({ value: c.id, label: `${c.name} ${c.count}` }))]}
              />
            </div>
            <div className="mb-5 flex flex-[1_1_260px] flex-wrap justify-end gap-2">
              <label className="flex-[1_1_200px] md:max-w-xs">
                <span className="sr-only">搜尋問答</span>
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋問題或回答…" className={inputCls} />
              </label>
              {canEdit && (
                <button type="button" className={btn()} onClick={() => setCatsOpen(true)}>
                  管理分類
                </button>
              )}
            </div>
          </div>

          {/* 問答列表 */}
          <section aria-label="問答列表" className="-mt-5 flex flex-col gap-2.5">
            {shown.length === 0 && <p className={`${card} px-5 py-6 text-center text-sm text-mute`}>{q ? "找不到符合的問答。" : "這個分類還沒有問答。"}</p>}
            {shown.map((i) => {
              const c = colorOf.get(i.cat) ?? CAT_COLORS[0];
              return (
                <article key={i.id} className={`${card} flex flex-wrap gap-x-5 gap-y-2 px-4 py-3.5 md:px-5 ${i.active ? "" : "border-dashed bg-[#FAFBF8]"}`}>
                  <div className="min-w-0 flex-[1_1_220px] md:max-w-[300px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md px-2 py-0.5 text-xs font-bold" style={{ background: c.bg, color: c.fg }}>
                        {catName(i.cat)}
                      </span>
                      {!i.active && <span className="text-xs font-bold text-mute">已停用</span>}
                    </div>
                    <h3 className={`mt-1.5 font-bold ${i.active ? "" : "text-ink2"}`}>{i.q}</h3>
                    {i.alt && <p className="mt-0.5 text-xs text-mute">也會問：{i.alt}</p>}
                  </div>
                  <div className={`min-w-0 flex-[999_1_320px] whitespace-pre-line text-sm leading-relaxed ${i.active ? "text-ink2" : "text-mute"}`}>
                    {i.a}
                    {i.notify && <div className="mt-1.5 text-xs font-bold text-[#8A4B00]">客人問到時，同時通知你</div>}
                  </div>
                  <div className="flex flex-none items-start gap-1">
                    <label className="flex min-h-9 cursor-pointer items-center gap-2 pr-1 text-[13px] text-ink2">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={i.active}
                        disabled={!canEdit || !!busy}
                        onChange={(e) => act(`t-${i.id}`, { action: "toggle", id: i.id, active: e.target.checked })}
                        className="h-5 w-5 accent-leaf"
                      />
                      啟用
                    </label>
                    {canEdit && (
                      <>
                        <button type="button" className={smallBtn("pri")} onClick={() => setEditing({ item: i })}>
                          <Icon name="edit" size={16} /> 編輯
                        </button>
                        <button
                          type="button"
                          className={smallBtn("danger")}
                          disabled={!!busy}
                          onClick={() => {
                            if (confirm(`確定刪除「${i.q}」？刪除後機器人就不會再用這段回答。`)) void act(`d-${i.id}`, { action: "delete", id: i.id });
                          }}
                        >
                          <Icon name="trash" size={16} /> 刪除
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </section>

          {/* 固定規則 */}
          <section aria-labelledby="fixed" className={`${card} flex flex-col gap-2 px-5 py-4`}>
            <h2 id="fixed" className="text-[17px] font-bold">
              系統固定規則（唯讀）
            </h2>
            <p className="text-[13px] text-mute">這些和金額、下單有關，寫在程式裡避免改錯；要調整請跟工程師說。</p>
            <ul className="list-disc pl-5 text-sm leading-7 text-ink2">
              {d.fixed.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {editing && d && (
        <Editor
          key={editing.item?.id ?? editing.alert?.id ?? "new"}
          editing={editing}
          cats={d.categories}
          defaultCat={cat !== "all" ? cat : undefined}
          onCatsChanged={reload}
          onClose={() => setEditing(null)}
          onSaved={async (text) => {
            setEditing(null);
            setErr("");
            setMsg(text);
            await reload();
          }}
          onReplyError={(e) => setErr(e)}
        />
      )}
      {catsOpen && d && (
        <CatsEditor
          cats={d.categories}
          onClose={() => setCatsOpen(false)}
          onSaved={async () => {
            setCatsOpen(false);
            await reload();
          }}
        />
      )}
    </main>
  );
}

/* ---------------- 新增／編輯問答 ---------------- */

function Editor({
  editing,
  cats,
  defaultCat,
  onCatsChanged,
  onClose,
  onSaved,
  onReplyError,
}: {
  editing: Editing;
  cats: CatView[];
  defaultCat?: string;
  onCatsChanged: () => Promise<void>;
  onClose: () => void;
  onSaved: (msg: string) => Promise<void>;
  onReplyError: (e: string) => void;
}) {
  const { item, alert } = editing;
  const [f, setF] = useState({
    cat: item?.cat ?? defaultCat ?? cats[0]?.id ?? "",
    q: item?.q ?? alert?.question ?? "",
    alt: item?.alt ?? "",
    a: item?.a ?? "",
    notify: item?.notify ?? false,
  });
  const [reply, setReply] = useState(!!alert);
  const [ask, setAsk] = useState(alert?.question || alert?.reason || item?.q || "");
  const [preview, setPreview] = useState<{ key: string; text: string; notes: string[] } | null>(null);
  const [trying, setTrying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newCat, setNewCat] = useState<string | null>(null);

  const set = (patch: Partial<typeof f>) => {
    setF({ ...f, ...patch });
    setError("");
  };
  // 預覽對應的內容：問答或試問的問題改過，就不能直接把預覽傳給客人
  const keyNow = JSON.stringify([f, ask, !!alert]);
  const followup = !!alert && ask === (alert.question || alert.reason);

  async function tryAsk() {
    if (!ask.trim()) return setError("請輸入要試問的問題");
    setTrying(true);
    setError("");
    try {
      const r = await call<{ text: string; notes: string[] }>("/api/admin/qa/try", {
        method: "POST",
        json: { ...f, id: item?.id, question: ask, followup },
      });
      setPreview({ key: keyNow, text: r.text, notes: r.notes });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setTrying(false);
    }
  }

  async function addCat() {
    const name = (newCat ?? "").trim();
    if (!name) return;
    setError("");
    try {
      await call("/api/admin/qa", { method: "POST", json: { action: "cats", cats: [...cats.map((c) => ({ id: c.id, name: c.name })), { name }] } });
      await onCatsChanged();
      setNewCat(null);
      setF((x) => ({ ...x, cat: `name:${name}` }));
    } catch (e) {
      setError(errMsg(e));
    }
  }
  // 新增分類後還不知道 id：重新載入後用名稱對回去
  const catValue = f.cat.startsWith("name:") ? (cats.find((c) => c.name === f.cat.slice(5))?.id ?? "") : f.cat;

  async function save() {
    if (!catValue) return setError("請選分類");
    setSaving(true);
    setError("");
    try {
      const usePreview = reply && followup && preview?.key === keyNow && preview.text;
      const r = await call<{ replied: string | null; replyError: string | null }>("/api/admin/qa", {
        method: "POST",
        json: {
          action: "save",
          ...f,
          cat: catValue,
          id: item?.id,
          ...(alert ? { alertId: alert.id, reply, ...(usePreview ? { replyText: preview!.text } : {}) } : {}),
        },
      });
      if (r.replyError) onReplyError(`問答已存好，但回覆 ${alert?.name} 失敗：${r.replyError}`);
      await onSaved(r.replied ? `問答已存好，也已用 LINE 回覆 ${alert?.name}。` : item ? "問答已更新，機器人立刻會用新的內容回答。" : "問答已新增，機器人立刻會用這段回答。");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title={item ? "編輯問答" : alert ? "加入問答" : "新增問答"}
      wide
      footer={
        <>
          <button type="button" className={btn()} onClick={onClose}>
            取消
          </button>
          <button type="button" className={btn("pri")} onClick={save} disabled={saving}>
            {saving ? "儲存中…" : alert && reply ? "儲存問答並回覆客人" : "儲存問答"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {alert && (
          <div className="rounded-lg border border-[#F0D9A8] bg-[#FFF8EA] px-3.5 py-2.5 text-sm text-[#6B3E00]">
            <b>客人原話</b>（{alert.name} · {ago(alert.at)}）
            <br />
            {alert.question ? `「${alert.question}」` : alert.reason}
          </div>
        )}

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="分類">
            {newCat === null ? (
              <select
                value={catValue}
                onChange={(e) => (e.target.value === "__new" ? setNewCat("") : set({ cat: e.target.value }))}
                className={inputCls}
              >
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="__new">＋ 新增分類…</option>
              </select>
            ) : (
              <span className="flex gap-2">
                <input
                  autoFocus
                  value={newCat}
                  maxLength={20}
                  placeholder="例如：甘露梨"
                  onChange={(e) => setNewCat(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void addCat())}
                  className={`${inputCls} font-normal`}
                />
                <button type="button" className={smallBtn("pri")} onClick={addCat}>
                  新增
                </button>
                <button type="button" className={smallBtn()} onClick={() => setNewCat(null)}>
                  取消
                </button>
              </span>
            )}
          </Field>
          <Field label="客人會這樣問">
            <input value={f.q} maxLength={200} onChange={(e) => set({ q: e.target.value })} className={`${inputCls} font-normal`} />
          </Field>
        </div>

        <Field label="其他問法（選填，用逗號分開）" hint={<span className="text-mute">機器人看得懂意思相近的問法，這欄只是幫它更準。</span>}>
          <input value={f.alt} maxLength={300} onChange={(e) => set({ alt: e.target.value })} className={`${inputCls} font-normal`} />
        </Field>

        <Field label="回答" hint={<span className="text-mute">寫重點就好，機器人會用親切的口氣回覆客人。</span>}>
          <textarea rows={4} value={f.a} maxLength={2000} onChange={(e) => set({ a: e.target.value })} className={`${inputCls} py-2 font-normal leading-relaxed`} />
        </Field>

        <div className="flex flex-col gap-1 text-sm">
          <label className="flex min-h-9 items-center gap-2.5">
            <input type="checkbox" checked={f.notify} onChange={(e) => set({ notify: e.target.checked })} className="h-5 w-5 accent-leaf" />
            客人問到這題時，也通知我（需要真人跟進）
          </label>
          {alert && (
            <label className="flex min-h-9 items-center gap-2.5">
              <input type="checkbox" checked={reply} onChange={(e) => setReply(e.target.checked)} className="h-5 w-5 accent-leaf" />
              存檔後，把這個答案用 LINE 回覆{alert.name}
            </label>
          )}
        </div>

        <section aria-labelledby="try" className="flex flex-col gap-2.5 rounded-xl border border-line bg-white px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="try" className="font-bold">
              先試問機器人
            </h3>
            <span className="text-xs text-mute">用還沒存檔的答案試，不會傳給客人</span>
          </div>
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="sr-only">試問的問題</span>
              <input value={ask} maxLength={500} onChange={(e) => setAsk(e.target.value)} placeholder="輸入客人可能會問的話" className={inputCls} />
            </label>
            <button type="button" className={btn()} onClick={tryAsk} disabled={trying}>
              {trying ? "思考中…" : "試問"}
            </button>
          </div>
          {preview && (
            <div className="flex flex-col gap-2 rounded-lg bg-chatbg p-3">
              <div className="max-w-[80%] self-start whitespace-pre-line rounded-[14px_14px_14px_4px] bg-white px-3 py-2 text-sm leading-relaxed">
                {preview.text || "（機器人沒有回覆文字）"}
              </div>
              {preview.notes.map((n) => (
                <div key={n} className="text-xs font-bold text-[#8A4B00]">
                  {n}
                </div>
              ))}
              {alert && reply && (
                <div className="text-xs text-ink2">
                  {followup && preview.key === keyNow ? "存檔後會把上面這段傳給客人。" : "內容改過了，存檔時會重新產生回覆再傳給客人。"}
                </div>
              )}
            </div>
          )}
        </section>

        {error && (
          <p role="alert" className="text-sm font-bold text-[#B3261E]">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- 管理分類 ---------------- */

function CatsEditor({ cats, onClose, onSaved }: { cats: CatView[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [rows, setRows] = useState(cats.map((c) => ({ id: c.id as string | undefined, name: c.name, count: c.count, key: c.id })));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const move = (i: number, d: -1 | 1) => {
    const next = [...rows];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setRows(next);
  };

  async function save() {
    setSaving(true);
    setError("");
    try {
      await call("/api/admin/qa", { method: "POST", json: { action: "cats", cats: rows.map((r) => ({ id: r.id, name: r.name })) } });
      await onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="管理分類"
      footer={
        <>
          <button type="button" className={btn()} onClick={onClose}>
            取消
          </button>
          <button type="button" className={btn("pri")} onClick={save} disabled={saving}>
            {saving ? "儲存中…" : "儲存分類"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="mb-1 text-[13px] text-mute">分類只是方便整理，機器人回答時全部問答都會參考。裡面還有問答的分類不能刪。</p>
        {rows.map((r, i) => (
          <div key={r.key} className="flex items-center gap-1.5">
            <label className="flex-1">
              <span className="sr-only">分類名稱</span>
              <input
                value={r.name}
                maxLength={20}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                className={inputCls}
              />
            </label>
            <span className="w-14 text-right text-xs text-mute">{r.count} 則</span>
            <button type="button" className={smallBtn()} aria-label="往上移" disabled={i === 0} onClick={() => move(i, -1)}>
              <Icon name="arrowUp" size={16} />
            </button>
            <button type="button" className={smallBtn()} aria-label="往下移" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
              <Icon name="arrowDown" size={16} />
            </button>
            <button
              type="button"
              className={smallBtn("danger")}
              aria-label={`刪除 ${r.name}`}
              title={r.count ? "裡面還有問答，不能刪" : "刪除"}
              disabled={r.count > 0 || rows.length <= 1}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${smallBtn("pri")} self-start`}
          onClick={() => setRows([...rows, { id: undefined, name: "", count: 0, key: `new-${Date.now()}` }])}
        >
          <Icon name="plus" size={16} /> 新增分類
        </button>
        {error && (
          <p role="alert" className="text-sm font-bold text-[#B3261E]">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
