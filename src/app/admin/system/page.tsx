"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "../_ui/icons";
import { call, Card, dangerBtn, errMsg, Field, inputCls, Modal, PageHeader, smallBtn, Table, Tabs, Td, UnlockPanel, useCodeGate, type CodeResult } from "../_ui/kit";
import { useMe } from "../_ui/me";
import { btn, card, ErrorBar } from "../_ui/ui";
import { USER_PAGES, type PageAccessSettings, type PageKey } from "@/lib/page-access";
import { AI_MODELS, KEY_LABEL, modelLabel, type AiChoice, type AiStatus } from "@/lib/ai-models";
import type { TrashView } from "@/lib/qa";

type Tab = "ai" | "users" | "access" | "data" | "trash";
const TABS: Tab[] = ["ai", "users", "access", "data", "trash"];

/* ---------------- 目前分頁，記在這台電腦的瀏覽器（重新整理後保留） ---------------- */
const TAB_KEY = "chou-line-admin-tab";
const tabListeners = new Set<() => void>();
let memoryTab: Tab | null = null;
function readTab(): Tab {
  if (memoryTab) return memoryTab;
  try {
    const v = localStorage.getItem(TAB_KEY) as Tab;
    return TABS.includes(v) ? v : "users";
  } catch {
    return "users";
  }
}
function writeTab(v: Tab) {
  memoryTab = v;
  try {
    localStorage.setItem(TAB_KEY, v);
  } catch {}
  tabListeners.forEach((l) => l());
}
function useTab(): [Tab, (v: Tab) => void] {
  const tab = useSyncExternalStore(
    (l) => {
      tabListeners.add(l);
      return () => tabListeners.delete(l);
    },
    readTab,
    () => "users" as Tab,
  );
  return [tab, writeTab];
}

export default function SystemPage() {
  const [tab, setTab] = useTab();
  const me = useMe();
  if (me && me.role !== "admin") {
    return (
      <main className="px-4 pt-10">
        <p className={`${card} mx-auto max-w-lg p-8 text-center`}>後台管理只有管理者可以使用。</p>
      </main>
    );
  }
  return (
    <main className="px-4 pb-10 pt-5 md:px-8 md:pt-7">
      <PageHeader title="後台管理" desc="查看機器人使用的 AI 版本、管理登入帳號與一般使用者可以看的頁面，以及檢視、刪除資料庫裡的所有資料。只有管理者看得到這一頁。" />
      <UnlockPanel />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "ai", label: "AI版本" },
          { value: "users", label: "使用者管理" },
          { value: "access", label: "頁面權限" },
          { value: "data", label: "所有資料" },
          { value: "trash", label: "已刪除紀錄" },
        ]}
      />
      {tab === "ai" ? <AiTab /> : tab === "users" ? <UsersTab /> : tab === "access" ? <AccessTab /> : tab === "data" ? <DataTab /> : <TrashTab />}
    </main>
  );
}

/** 只檢查驗證碼、不修改資料（打開表單前先確認） */
async function verifyCode(code: string): Promise<CodeResult> {
  try {
    await call("/api/admin/system/verify-code", { method: "POST", code });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

const menuImg = (name: string) => `/api/admin/richmenu/image?n=${name}`;
const fmtTime = (s: string | null) => (s ? new Date(s).toLocaleString("zh-TW", { hour12: false, timeZone: "Asia/Taipei" }) : "—");

/* ---------------- 已刪除紀錄（問答管理；同 chou-platform） ---------------- */
function TrashTab() {
  const [items, setItems] = useState<TrashView[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [viewing, setViewing] = useState<TrashView | null>(null);
  const gate = useCodeGate();

  useEffect(() => {
    call<TrashView[]>("/api/admin/system/trash").then(setItems, (e) => setError(errMsg(e)));
  }, []);

  function act(t: TrashView, method: "POST" | "DELETE") {
    const restore = method === "POST";
    gate.ask({
      title: restore ? "還原紀錄" : "永久刪除",
      confirmLabel: restore ? "確認還原" : "確認永久刪除",
      danger: !restore,
      message:
        t.kind === "richmenu" ? (
          restore ? (
            <>
              即將還原圖文選單「<b>{t.q}</b>」，會回到圖文選單頁的「換過的選單」（不會換上 LINE，要用時再按「換回這個」）。
            </>
          ) : (
            <>
              即將永久刪除圖文選單「<b>{t.q}</b>」（連同沒有其他選單在用的圖片），之後無法再還原。
            </>
          )
        ) : restore ? (
          <>
            即將還原問答「<b>{t.q}</b>」，還原後會回到問答管理，機器人馬上會用。
          </>
        ) : (
          <>
            即將永久刪除問答「<b>{t.q}</b>」的備份（連同照片），之後無法再還原。
          </>
        ),
      submit: async (code) => {
        try {
          const r = await call<{ note?: string }>(`/api/admin/system/trash/${t.id}`, { method, code });
          setNotice(restore ? `已還原「${t.q}」${r.note ? `（${r.note}）` : ""}` : `已永久刪除「${t.q}」`);
        } catch (e) {
          return { ok: false, error: errMsg(e) };
        }
        setItems((l) => l?.filter((x) => x.id !== t.id) ?? null);
        setViewing(null);
        return { ok: true };
      },
    });
  }

  return (
    <>
      <p className="mb-4 text-sm text-mute">
        在問答管理刪除的問答、圖文選單刪除的選單（和「換過的選單」超過 10 個被移出的）會備份在這裡，可以還原或永久刪除。照片、圖片在永久刪除前都會保留。
      </p>
      {notice && <p className="mb-4 rounded-lg bg-[#DFF2E7] px-4 py-2.5 text-sm font-bold text-[#17613E]">{notice}</p>}
      <ErrorBar messages={[error]} />
      <Table head={["類型", "客人問／選單名稱", "分類／版型", "照片", "刪除時間", "刪除者", ""]}>
        {(items ?? []).map((t) => (
          <tr key={t.id} className="hover:bg-[#FAFBF8]">
            <Td className="whitespace-nowrap">
              {t.kind === "richmenu" ? (
                <span className="rounded-full bg-[#E3ECF7] px-2 py-0.5 text-xs font-bold text-[#1D4E8F]">圖文選單</span>
              ) : (
                <span className="rounded-full bg-[#E6F2EB] px-2 py-0.5 text-xs font-bold text-leaf">問答管理</span>
              )}
            </Td>
            <Td className="font-bold">{t.q || "—"}</Td>
            <Td className="whitespace-nowrap">{t.catGone ? <span className="text-[#B3261E]">（分類已刪除）</span> : t.catName}</Td>
            <Td className="whitespace-nowrap text-mute">
              {t.kind === "richmenu" && t.image ? (
                <button type="button" onClick={() => setViewing(t)} className="block w-28 cursor-zoom-in" aria-label={`放大「${t.q}」`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={menuImg(t.image)} alt="" className="block w-full rounded border border-line" />
                </button>
              ) : t.photos ? (
                `${t.photos} 張`
              ) : (
                "—"
              )}
            </Td>
            <Td className="whitespace-nowrap text-mute">{fmtTime(t.deletedAt)}</Td>
            <Td className="whitespace-nowrap text-mute">{t.deletedBy || "—"}</Td>
            <Td className="whitespace-nowrap text-right">
              <button type="button" className={smallBtn()} onClick={() => setViewing(t)}>
                <Icon name="eye" size={14} /> 檢視
              </button>
              <button type="button" className={`${smallBtn()} text-leaf`} onClick={() => act(t, "POST")}>
                <Icon name="undo" size={14} /> 還原
              </button>
              <button type="button" className={smallBtn("danger")} onClick={() => act(t, "DELETE")} aria-label={`永久刪除 ${t.q}`}>
                <Icon name="trash" size={14} />
              </button>
            </Td>
          </tr>
        ))}
        {!items?.length && (
          <tr>
            <Td colSpan={7} className="py-8 text-center text-mute">
              {items === null && !error ? "載入中…" : "沒有已刪除的紀錄"}
            </Td>
          </tr>
        )}
      </Table>

      {viewing && (
        <Modal
          wide
          onClose={() => setViewing(null)}
          title={`已刪除：${viewing.q}`}
          footer={
            <>
              <button type="button" className={`${dangerBtn} mr-auto`} onClick={() => act(viewing, "DELETE")}>
                <Icon name="trash" size={15} /> 永久刪除
              </button>
              <button type="button" className={btn()} onClick={() => setViewing(null)}>
                關閉
              </button>
              <button type="button" className={btn("pri")} onClick={() => act(viewing, "POST")}>
                <Icon name="undo" size={15} /> 還原
              </button>
            </>
          }
        >
          {viewing.kind === "richmenu" ? (
            <div className="mb-4 flex flex-col gap-3 text-sm">
              {viewing.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={menuImg(viewing.image)} alt={`圖文選單「${viewing.q}」`} className="block w-full rounded-lg border border-line" />
              )}
              <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-mute">版型</dt>
                <dd>{viewing.catName}</dd>
                <dt className="text-mute">每一格</dt>
                <dd className="whitespace-pre-wrap">{viewing.answer || "—"}</dd>
                <dt className="text-mute">刪除</dt>
                <dd>
                  {fmtTime(viewing.deletedAt)}・{viewing.deletedBy || "—"}
                </dd>
              </dl>
            </div>
          ) : (
            <dl className="mb-4 grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-mute">分類</dt>
              <dd>{viewing.catGone ? "（分類已刪除，還原時放到第一個分類）" : viewing.catName}</dd>
              <dt className="text-mute">回答</dt>
              <dd className="whitespace-pre-wrap">{viewing.answer || "—"}</dd>
              <dt className="text-mute">照片</dt>
              <dd>{viewing.photos ? `${viewing.photos} 張` : "—"}</dd>
            </dl>
          )}
          <details>
            <summary className="cursor-pointer text-sm text-mute">原始資料</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-white p-4 font-mono text-xs ring-1 ring-line">{JSON.stringify(viewing.data, null, 2)}</pre>
          </details>
        </Modal>
      )}
      {gate.dialog}
    </>
  );
}

/* ---------------- AI 費用估算 ---------------- */

/** 美元：小金額多顯示幾位小數 */
const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
/** 換算台幣（約 1 美元 ≈ 32 台幣，只是方便看） */
const twd = (n: number) => `約台幣 ${Math.round(n * 32).toLocaleString("zh-TW")} 元`;

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-3.5 ${warn ? "border-[#E8A54B] bg-[#FFF6E8]" : "border-line bg-white"}`}>
      <div className="text-xs text-mute">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${warn ? "text-[#8A4B00]" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-mute">{sub}</div>}
    </div>
  );
}

function CostCard({ data, onSaved }: { data: AiStatus; onSaved: (d: AiStatus) => void }) {
  const c = data.cost;
  const [v, setV] = useState("");
  const gate = useCodeGate();
  const low = c.remaining !== null && c.remaining < 1;
  const valid = /^\d+(\.\d{1,2})?$/.test(v.trim());

  const save = () =>
    gate.ask({
      title: "輸入儲值餘額",
      confirmLabel: "儲存",
      message: (
        <>
          目前 Claude 帳戶餘額設為 <b>${Number(v)}</b> 美元，從現在開始重新計算花費。
        </>
      ),
      submit: async (code) => {
        try {
          onSaved(await call<AiStatus>("/api/admin/system/ai", { method: "PUT", json: { balance: Number(v) }, code }));
          setV("");
          return { ok: true };
        } catch (e) {
          return { ok: false, error: errMsg(e) };
        }
      },
    });

  return (
    <Card title="Claude 費用估算">
      <p className="mb-4 text-sm text-mute">
        每次 Claude 回答都會記下實際用掉的字數，照官方價目換算成美元。這是估算值，真正的餘額以 platform.claude.com 的 Billing 為準；儲值後請在下面重新輸入一次餘額。
      </p>
      {c.balance === null ? (
        <p className="mb-4 rounded-lg bg-[#FFF4E0] px-3 py-2.5 text-sm text-[#6B3E00]">還沒輸入儲值餘額。輸入目前的餘額（例如 5），就會開始顯示預估剩餘金額。</p>
      ) : (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="預估剩餘" value={usd(c.remaining ?? 0)} sub={low ? "快用完了，記得儲值" : twd(c.remaining ?? 0)} warn={low} />
          <Stat label="已花費" value={usd(c.spent)} sub={c.balanceAt ? `${fmtTime(c.balanceAt)} 輸入 $${c.balance} 之後` : undefined} />
          <Stat label="今天／最近 7 天" value={`${usd(c.today)}／${usd(c.week)}`} />
          <Stat
            label="平均每則回答"
            value={c.perAnswer !== null ? usd(c.perAnswer) : "—"}
            sub={c.answersLeft !== null ? `剩下的錢約還能回答 ${c.answersLeft.toLocaleString("zh-TW")} 則` : "有回答紀錄後才算得出來"}
          />
        </div>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save();
        }}
      >
        <Field label={c.balance === null ? "目前的儲值餘額（美元）" : "重新輸入餘額（美元，儲值後用）"}>
          <input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder="例如 5" className={`${inputCls} w-32!`} />
        </Field>
        <button type="submit" className={btn("pri")} disabled={!valid}>
          儲存餘額
        </button>
      </form>

      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-2 text-sm font-bold">Gemini 今天的使用次數（免費方案）</div>
        <div className="flex flex-wrap gap-2">
          {data.gemini.map((g) => {
            const full = g.limit !== null && g.today >= g.limit;
            const near = g.limit !== null && !full && g.today >= g.limit * 0.8;
            return (
              <span
                key={g.model}
                className={`rounded-full px-3 py-1 text-sm ${full ? "bg-[#FDECEA] font-bold text-[#9E2A1C]" : near ? "bg-[#FFF1DC] font-bold text-[#8A4B00]" : "bg-[#ECEEE8] text-ink2"}`}
              >
                {g.label}：{g.today}
                {g.limit !== null ? ` / ${g.limit} 次${full ? "（今天用完了）" : ""}` : " 次"}
              </span>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-mute">Gemini 免費方案不用錢，但每天有次數限制，用完要等明天（台灣時間下午 3～4 點左右重置）。</p>
      </div>
      {gate.dialog}
    </Card>
  );
}

/* ---------------- AI 版本 ---------------- */
function AiTab() {
  const [data, setData] = useState<AiStatus | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<AiChoice | null>(null);
  const [saved, setSaved] = useState("");
  const gate = useCodeGate();
  useEffect(() => {
    call<AiStatus>("/api/admin/system/ai").then(setData, (e) => setError(errMsg(e)));
  }, []);
  if (error) return <ErrorBar messages={[`讀取失敗：${error}`]} />;
  if (!data) return <p className="text-sm text-mute">載入中…</p>;

  const cur = draft ?? data.choice;
  const changed = cur.primary !== data.choice.primary || cur.fallback !== data.choice.fallback;
  const week = data.days.slice(0, 7);
  const total = (d: AiStatus["days"][number]) => d.counts.reduce((s, c) => s + c.n, 0);
  const options = (other: string) =>
    AI_MODELS.map((m) => {
      const noKey = !data.keys[m.provider];
      return (
        <option key={m.id} value={m.id} disabled={noKey || m.id === other}>
          {m.label}（{noKey ? `主機沒有${KEY_LABEL[m.provider]}` : m.id === other ? "已選為另一個" : m.note}）
        </option>
      );
    });

  const save = () =>
    gate.ask({
      title: "更換 AI 版本",
      confirmLabel: "測試並儲存",
      message: (
        <>
          主版本改為 <b>{modelLabel(cur.primary)}</b>、備援改為 <b>{modelLabel(cur.fallback)}</b>。會先實際測試兩個版本都能回答才儲存，儲存後立即生效。
        </>
      ),
      submit: async (code) => {
        try {
          setData(await call<AiStatus>("/api/admin/system/ai", { method: "PUT", json: cur, code }));
          setDraft(null);
          setSaved("已更換，下一則客人訊息開始使用新的版本。");
          return { ok: true };
        } catch (e) {
          return { ok: false, error: errMsg(e) };
        }
      },
    });

  return (
    <div className="flex flex-col gap-5">
      <Card title="更換版本">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="主版本（每次先用這個回答）">
            <select value={cur.primary} onChange={(e) => (setSaved(""), setDraft({ ...cur, primary: e.target.value }))} className={inputCls}>
              {options(cur.fallback)}
            </select>
          </Field>
          <Field label="備援（主版本失敗或太慢時改用）">
            <select value={cur.fallback} onChange={(e) => (setSaved(""), setDraft({ ...cur, fallback: e.target.value }))} className={inputCls}>
              {options(cur.primary)}
            </select>
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-mute">
            需要驗證碼；儲存前會先測試，不能用的版本不會存。
            {data.updated && `上次更換：${fmtTime(data.updated.at)}${data.updated.by ? `（${data.updated.by}）` : ""}`}
          </p>
          <div className="flex gap-2">
            <button type="button" className={btn()} disabled={!changed} onClick={() => setDraft(null)}>
              取消變更
            </button>
            <button type="button" className={btn("pri")} disabled={!changed} onClick={save}>
              儲存版本
            </button>
          </div>
        </div>
        {saved && <p className="mt-3 rounded-lg bg-[#DFF2E7] px-3 py-2 text-sm font-bold text-[#17613E]">{saved}</p>}
      </Card>

      <CostCard data={data} onSaved={setData} />

      <Card title="目前使用的 AI 版本">
        <p className="mb-4 text-sm text-mute">機器人每次都先用主版本回答；主版本出錯或太久沒回應，才依序改用備援。備援也失敗時，最後再試 Gemini 3.5 Flash Lite。</p>
        <div className="grid gap-3 md:grid-cols-3">
          {data.chain.map((m, i) => (
            <div key={m.id} className={`rounded-xl p-4 ${i === 0 ? "border-2 border-leaf bg-[#EEF7F1]" : "border border-line bg-white"}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${i === 0 ? "bg-leaf text-white" : "bg-[#E4E8E1] text-ink2"}`}>{m.role}</span>
                <span className="text-xs text-mute">{m.provider}</span>
              </div>
              <div className="text-lg font-bold">{m.label}</div>
              <div className="text-xs text-mute">
                版本代號：<span className="font-mono">{m.id}</span>
              </div>
              <div className={`mt-2 text-xs font-bold ${m.keySet ? "text-[#17613E]" : "text-[#B3261E]"}`}>{m.keySet ? `● ${m.keyEnv}已設定` : `● 主機沒有${m.keyEnv}`}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="實際回答的版本">
        {data.last ? (
          <p className="mb-4 text-sm">
            最近一次回答：<b>{data.last.label}</b>
            <span className="text-mute">（{fmtTime(data.last.at)}）</span>
            {data.last.fellBack && <span className="ml-2 rounded-full bg-[#FFF1DC] px-2 py-0.5 text-xs font-bold text-[#8A4B00]">主版本失敗，改用備援</span>}
          </p>
        ) : (
          <p className="mb-4 text-sm text-mute">還沒有紀錄（從這次更新之後開始記錄）。</p>
        )}
        <Table head={["日期", "回答次數", "各版本", "改用備援", "Claude 花費（估）"]}>
          {week.map((d) => (
            <tr key={d.date}>
              <Td className="whitespace-nowrap">{d.date}</Td>
              <Td className="tabular-nums">{total(d)}</Td>
              <Td>{d.counts.map((c) => `${c.label} ${c.n}`).join("、")}</Td>
              <Td className={`tabular-nums ${d.fallback ? "font-bold text-[#8A4B00]" : "text-mute"}`}>{d.fallback}</Td>
              <Td className="whitespace-nowrap tabular-nums">{usd(d.cost)}</Td>
            </tr>
          ))}
          {!week.length && (
            <tr>
              <Td colSpan={5} className="py-6 text-center text-mute">
                還沒有紀錄
              </Td>
            </tr>
          )}
        </Table>
        <p className="mt-3 text-xs text-mute">次數包含客人訊息與問答管理的「試問」。「改用備援」次數多，代表主版本不穩定。</p>
      </Card>
      {gate.dialog}
    </div>
  );
}

/* ---------------- 使用者管理 ---------------- */
type User = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

function UsersTab() {
  const me = useMe();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<{ code: string } | null>(null);
  const [resetting, setResetting] = useState<{ user: User; code: string } | null>(null);
  // 修改名稱時取消輸入驗證碼：換 key 讓輸入框回到原本的名稱
  const [nameKey, setNameKey] = useState(0);
  const gate = useCodeGate();

  useEffect(() => {
    call<User[]>("/api/admin/system/users").then(setUsers, (e) => setError(errMsg(e)));
  }, []);

  async function patch(u: User, body: Partial<User> & { password?: string }, code: string): Promise<CodeResult> {
    try {
      const saved = await call<User>(`/api/admin/system/users/${u.id}`, { method: "PATCH", json: body, code });
      setUsers((list) => list?.map((x) => (x.id === saved.id ? saved : x)) ?? null);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  const askPatch = (u: User, body: Partial<User>, what: string) =>
    gate.ask({
      title: "修改使用者",
      confirmLabel: "確認修改",
      message: (
        <>
          修改 <b>{u.email}</b> 的{what}需要驗證碼。
        </>
      ),
      submit: (code) => patch(u, body, code),
      onCancel: () => setNameKey((k) => k + 1),
    });

  const askAdd = () =>
    gate.ask({
      title: "新增使用者",
      confirmLabel: "下一步",
      message: "新增使用者需要驗證碼。",
      submit: async (code) => {
        const res = await verifyCode(code);
        if (res.ok) setAdding({ code });
        return res;
      },
    });

  const askReset = (u: User) =>
    gate.ask({
      title: "重設密碼",
      confirmLabel: "下一步",
      message: (
        <>
          重設 <b>{u.email}</b> 的密碼需要驗證碼。
        </>
      ),
      submit: async (code) => {
        const res = await verifyCode(code);
        if (res.ok) setResetting({ user: u, code });
        return res;
      },
    });

  const askDelete = (u: User) =>
    gate.ask({
      title: "刪除使用者",
      confirmLabel: "確認刪除",
      danger: true,
      message: (
        <>
          即將刪除使用者 <b>{u.email}</b>，無法復原。
        </>
      ),
      submit: async (code) => {
        try {
          await call(`/api/admin/system/users/${u.id}`, { method: "DELETE", code });
          setUsers((list) => list?.filter((x) => x.id !== u.id) ?? null);
          return { ok: true };
        } catch (e) {
          return { ok: false, error: errMsg(e) };
        }
      },
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-mute">管理者可以回覆客人、修改資料並進入後台管理；一般使用者登入後只能檢視。沒有註冊頁，帳號都從這裡建立。</p>
        <button type="button" className={btn("pri")} onClick={askAdd}>
          <Icon name="plus" size={16} /> 新增使用者
        </button>
      </div>
      <ErrorBar messages={[error]} />
      <Table head={["Email", "名稱", "身分", "狀態", "最後登入", "建立時間", ""]}>
        {users?.map((u) => {
          const self = u.id === me?.id;
          return (
            <tr key={u.id} className="hover:bg-[#FAFBF8]">
              <Td className="whitespace-nowrap font-bold">
                {u.email}{" "}
                {self && <span className="ml-1 rounded-full bg-[#DFF2E7] px-2 py-0.5 text-[11px] text-[#17613E]">我</span>}
              </Td>
              <Td>
                <input
                  key={`${u.name}-${nameKey}`}
                  defaultValue={u.name}
                  placeholder="（未填）"
                  aria-label={`${u.email} 的名稱`}
                  className={`${inputCls} min-w-28`}
                  onBlur={(e) => e.target.value !== u.name && askPatch(u, { name: e.target.value }, "名稱")}
                />
              </Td>
              <Td>
                <select
                  value={u.role}
                  disabled={self}
                  aria-label={`${u.email} 的身分`}
                  className={`${inputCls} min-w-32`}
                  title={self ? "不能變更自己的身分" : undefined}
                  onChange={(e) => askPatch(u, { role: e.target.value as User["role"] }, "身分")}
                >
                  <option value="admin">管理者</option>
                  <option value="user">一般使用者</option>
                </select>
              </Td>
              <Td>
                <label className={`flex items-center gap-2 whitespace-nowrap ${self ? "opacity-50" : "cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    checked={u.active}
                    disabled={self}
                    onChange={(e) => askPatch(u, { active: e.target.checked }, e.target.checked ? "狀態（啟用）" : "狀態（停用）")}
                    className="h-4 w-4 accent-[#1e6b47]"
                  />
                  {u.active ? "啟用" : <span className="text-[#B3261E]">停用</span>}
                </label>
              </Td>
              <Td className="whitespace-nowrap text-mute">{fmtTime(u.lastLoginAt)}</Td>
              <Td className="whitespace-nowrap text-mute">{fmtTime(u.createdAt)}</Td>
              <Td className="whitespace-nowrap text-right">
                <button type="button" className={smallBtn()} onClick={() => askReset(u)}>
                  <Icon name="key" size={14} /> 重設密碼
                </button>
                {!self && (
                  <button type="button" className={smallBtn("danger")} onClick={() => askDelete(u)} aria-label={`刪除 ${u.email}`}>
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </Td>
            </tr>
          );
        })}
        {users === null && !error && (
          <tr>
            <Td colSpan={7} className="py-8 text-center text-mute">
              載入中…
            </Td>
          </tr>
        )}
      </Table>
      {gate.dialog}
      {adding && <AddUserModal code={adding.code} onClose={() => setAdding(null)} onAdded={(u) => setUsers((list) => [...(list ?? []), u])} />}
      {resetting && (
        <PasswordModal user={resetting.user} onClose={() => setResetting(null)} onSave={(password) => patch(resetting.user, { password }, resetting.code)} />
      )}
    </>
  );
}

/** code：打開前已驗證過的驗證碼，建立時送給後端 */
function AddUserModal({ code, onClose, onAdded }: { code: string; onClose: () => void; onAdded: (u: User) => void }) {
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "user" as User["role"] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onAdded(await call<User>("/api/admin/system/users", { method: "POST", json: form, code }));
      onClose();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="新增使用者"
      footer={
        <>
          <button type="button" className={btn()} onClick={onClose}>
            取消
          </button>
          <button type="submit" form="add-user" disabled={busy} className={btn("pri")}>
            {busy ? "建立中…" : "建立"}
          </button>
        </>
      }
    >
      <form id="add-user" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" className="sm:col-span-2">
          <input type="email" required autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} />
        </Field>
        <Field label="名稱">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例：阿明" className={inputCls} />
        </Field>
        <Field label="身分">
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User["role"] })} className={inputCls}>
            <option value="user">一般使用者（只能看）</option>
            <option value="admin">管理者</option>
          </select>
        </Field>
        <Field label="密碼（至少 8 個字元）" className="sm:col-span-2">
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className={inputCls}
          />
        </Field>
        {error && <p className="rounded-lg bg-[#FDECEA] px-3 py-2 text-sm text-[#9E2A1C] sm:col-span-2">{error}</p>}
      </form>
    </Modal>
  );
}

function PasswordModal({ user, onClose, onSave }: { user: User; onClose: () => void; onSave: (p: string) => Promise<CodeResult> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await onSave(password);
    if (res.ok) return onClose();
    setError(`修改失敗：${res.error}`);
    setBusy(false);
  }

  return (
    <Modal
      onClose={onClose}
      title={`重設密碼：${user.email}`}
      footer={
        <>
          <button type="button" className={btn()} onClick={onClose}>
            取消
          </button>
          <button type="submit" form="reset-password" disabled={busy} className={btn("pri")}>
            {busy ? "儲存中…" : "儲存新密碼"}
          </button>
        </>
      }
    >
      <form id="reset-password" onSubmit={submit} className="flex flex-col gap-3">
        <Field label="新密碼（至少 8 個字元）">
          <input
            type="password"
            required
            minLength={8}
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
          />
        </Field>
        {error && <p className="text-sm text-[#9E2A1C]">{error}</p>}
      </form>
    </Modal>
  );
}

/* ---------------- 頁面權限 ---------------- */
const GROUPS = [...new Set(USER_PAGES.map((p) => p.group))].map((g) => ({ name: g, pages: USER_PAGES.filter((p) => p.group === g) }));
type Draft = { allowed: PageKey[]; hidden: Record<string, PageKey[]> };

/**
 * ① 一般使用者可以看的頁面，② 個別帳號再隱藏。
 * 帳號看得到的頁面 ＝ ① 有勾 且 ② 沒勾；管理者永遠看得到全部。
 */
function AccessTab() {
  const [data, setData] = useState<PageAccessSettings | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState("");
  const gate = useCodeGate();

  useEffect(() => {
    call<PageAccessSettings>("/api/admin/system/page-access").then(setData, (e) => setError(errMsg(e)));
  }, []);

  if (error) return <ErrorBar messages={[`讀取失敗：${error}`]} />;
  if (!data) return <p className="text-sm text-mute">載入中…</p>;

  const cur: Draft = draft ?? { allowed: data.allowed, hidden: Object.fromEntries(data.users.map((u) => [u.id, u.hiddenPages])) };
  const user = data.users.find((u) => u.id === selected) ?? data.users[0];
  const hiddenOf = (id: string) => cur.hidden[id] ?? [];
  const visibleFor = (id: string) => cur.allowed.filter((k) => !hiddenOf(id).includes(k));
  const toggle = (list: PageKey[], k: PageKey) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);

  const save = () =>
    gate.ask({
      title: "儲存頁面權限",
      confirmLabel: "儲存",
      message: "修改一般使用者可以看的頁面需要驗證碼。",
      submit: async (code) => {
        try {
          setData(await call<PageAccessSettings>("/api/admin/system/page-access", { method: "PUT", json: cur, code }));
          setDraft(null);
          return { ok: true };
        } catch (e) {
          return { ok: false, error: errMsg(e) };
        }
      },
    });

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="① 一般使用者可以看的頁面"
        action={
          <span className="rounded-full bg-[#DFF2E7] px-3 py-1 text-xs font-bold text-[#17613E]">
            一般使用者可看 {cur.allowed.length} / {USER_PAGES.length} 頁
          </span>
        }
      >
        <p className="mb-4 text-sm text-mute">打勾＝所有一般使用者都看得到；沒打勾的頁面會從左邊選單消失，直接輸入網址也看不到內容，對應的資料也不會傳給他。</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g.name} className="rounded-xl border border-line p-3">
              <div className="mb-2 text-sm font-bold text-leaf">{g.name}</div>
              {g.pages.map((p) => {
                const on = cur.allowed.includes(p.key);
                return (
                  <label key={p.key} className={`flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2 ${on ? "bg-[#EEF7F1]" : "text-mute"}`}>
                    <input type="checkbox" checked={on} onChange={() => setDraft({ ...cur, allowed: toggle(cur.allowed, p.key) })} className="h-4 w-4 accent-[#1e6b47]" />
                    {p.label}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-mute">
          <Icon name="lock" size={13} /> 只有管理者能用（不能開給一般使用者）：後台管理；回覆客人、暫停機器人、寄出通知等操作也只有管理者能做。
        </p>
      </Card>

      <Card title="② 個別帳號再隱藏（選填）">
        <p className="mb-4 text-sm text-mute">先選帳號，再勾選要「對這個帳號隱藏」的頁面。只能比 ① 更少，不能多開；① 已關掉的頁面會鎖住。</p>
        {!user ? (
          <p className="rounded-lg border border-dashed border-field py-8 text-center text-sm text-mute">目前沒有一般使用者帳號，請先到「使用者管理」新增</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(200px,260px)_1fr_minmax(200px,260px)] lg:items-start">
            <div className="flex flex-col gap-2">
              <div className="text-sm font-bold text-ink2">一般使用者帳號</div>
              {data.users.map((u) => {
                const n = cur.allowed.filter((k) => hiddenOf(u.id).includes(k)).length;
                return (
                  <button
                    key={u.id}
                    type="button"
                    aria-pressed={u.id === user.id}
                    onClick={() => setSelected(u.id)}
                    className={`flex w-full flex-col items-start gap-0.5 rounded-xl px-3.5 py-3 text-left ${
                      u.id === user.id ? "border-2 border-leaf bg-[#EEF7F1]" : "border border-line bg-white hover:bg-[#FAFBF8]"
                    }`}
                  >
                    <span className="font-bold">
                      {u.name || u.email}
                      {!u.active && <span className="ml-1.5 text-xs font-normal text-mute">（已停用）</span>}
                    </span>
                    <span className="text-xs text-mute">{u.email}</span>
                    <span className={`mt-1 rounded-full px-2 py-0.5 text-xs font-bold ${n ? "bg-[#FFF1DC] text-[#8A4B00]" : "bg-[#DFF2E7] text-[#17613E]"}`}>
                      {n ? `另外隱藏 ${n} 頁` : "跟一般使用者相同"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="rounded-xl border border-line p-4">
              <div className="mb-3 flex items-center gap-2 font-bold">
                <Icon name="eyeOff" size={18} className="text-[#C2621B]" /> 對「{user.name || user.email}」隱藏這些頁面
              </div>
              <div className="flex flex-col gap-3">
                {GROUPS.map((g) => (
                  <div key={g.name}>
                    <div className="mb-1 text-xs font-bold text-leaf">{g.name}</div>
                    {g.pages.map((p) => {
                      const off = !cur.allowed.includes(p.key);
                      const hidden = !off && hiddenOf(user.id).includes(p.key);
                      return (
                        <label
                          key={p.key}
                          className={`flex min-h-10 items-center gap-2.5 rounded-lg px-2 ${
                            off ? "cursor-not-allowed bg-ground text-mute line-through" : hidden ? "cursor-pointer bg-[#FFF4E8]" : "cursor-pointer"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={hidden}
                            disabled={off}
                            onChange={() => setDraft({ ...cur, hidden: { ...cur.hidden, [user.id]: toggle(hiddenOf(user.id), p.key) } })}
                            className="h-4 w-4 accent-[#C2621B]"
                          />
                          <span className="flex-1">{p.label}</span>
                          <span className={`text-xs font-bold ${off ? "text-mute" : hidden ? "text-[#8A4B00]" : "text-[#17613E]"}`}>
                            {off ? "① 已關閉" : hidden ? "已隱藏" : "看得到"}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <aside aria-label="登入後選單預覽" className="rounded-xl bg-forest p-4 text-white">
              <div className="text-xs text-[#A9C4B6]">預覽：{user.name || user.email} 登入後的選單</div>
              {GROUPS.map((g) => {
                const pages = g.pages.filter((p) => visibleFor(user.id).includes(p.key));
                if (!pages.length) return null;
                return (
                  <div key={g.name} className="pt-3">
                    <div className="mb-1 text-xs font-bold text-[#8FB3A1]">{g.name}</div>
                    {pages.map((p) => (
                      <div key={p.key} className="mb-0.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm">
                        {p.label}
                      </div>
                    ))}
                  </div>
                );
              })}
              {visibleFor(user.id).length === 0 && <div className="pt-3 text-sm text-[#FFC98A]">這個帳號登入後看不到任何頁面</div>}
              <div className="pt-3 text-xs text-[#A9C4B6]">共 {visibleFor(user.id).length} 個頁面</div>
            </aside>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-mute">規則：帳號看得到的頁面 ＝ ① 有勾 且 ② 沒勾。管理者永遠看得到全部。儲存需要後台驗證碼。</p>
        <div className="flex gap-2">
          <button type="button" className={btn()} disabled={!draft} onClick={() => setDraft(null)}>
            取消變更
          </button>
          <button type="button" className={btn("pri")} disabled={!draft} onClick={save}>
            儲存權限設定
          </button>
        </div>
      </div>
      {gate.dialog}
    </div>
  );
}

/* ---------------- 所有資料 ---------------- */
type CollInfo = { key: string; label: string; count: number };
type Row = { id: string; summary: string; fields: number; doc: Record<string, unknown> };
type RowsData = { rows: Row[]; total: number; page: number; pages: number };

function DataTab() {
  const [colls, setColls] = useState<CollInfo[] | null>(null);
  const [coll, setColl] = useState("lineUsers");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: RowsData; error?: string } | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
  const gate = useCodeGate();

  const key = `${coll}|${search}|${page}|${version}`;
  useEffect(() => {
    call<{ collections: CollInfo[] }>("/api/admin/system/data").then(
      (d) => setColls(d.collections),
      () => {},
    );
  }, [version]);
  useEffect(() => {
    call<RowsData>(`/api/admin/system/data?c=${coll}&q=${encodeURIComponent(search)}&page=${page}`).then(
      (data) => setResult({ key, data }),
      (e) => setResult({ key, error: errMsg(e) }),
    );
  }, [coll, search, page, key]);

  const loading = result?.key !== key;
  const data = result?.data;
  const label = colls?.find((c) => c.key === coll)?.label ?? coll;

  /** 刪除一筆；LINE 好友還有對話或草稿時，會再確認是否一併刪除 */
  async function del(r: Row, code: string): Promise<CodeResult> {
    const url = `/api/admin/system/data?c=${coll}&id=${encodeURIComponent(r.id)}`;
    try {
      await call(url, { method: "DELETE", code });
    } catch (e) {
      const err = e as Error & { status?: number; data?: { needsCascade?: boolean } };
      if (err.status !== 409 || !err.data?.needsCascade) return { ok: false, error: err.message };
      if (!confirm(err.message)) return { ok: true };
      try {
        await call(`${url}&cascade=1`, { method: "DELETE", code });
      } catch (e2) {
        return { ok: false, error: errMsg(e2) };
      }
    }
    setViewing(null);
    setVersion((v) => v + 1);
    return { ok: true };
  }

  const askDelete = (r: Row) =>
    gate.ask({
      title: "刪除資料",
      confirmLabel: "確認刪除",
      danger: true,
      message: (
        <>
          即將刪除{label}「<b>{r.summary || r.id}</b>」，無法復原。
        </>
      ),
      submit: (code) => del(r, code),
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <section className={`${card} h-fit p-2`}>
        <nav aria-label="資料集合" className="flex flex-col">
          {(colls ?? []).map((c) => (
            <button
              key={c.key}
              type="button"
              aria-current={c.key === coll ? "true" : undefined}
              onClick={() => {
                setColl(c.key);
                setQ("");
                setSearch("");
                setPage(1);
              }}
              className={`flex min-h-10 items-center justify-between gap-2 rounded-lg px-3 text-left text-sm ${
                c.key === coll ? "bg-forest3 font-bold text-white" : "text-ink hover:bg-ground"
              }`}
            >
              <span>{c.label}</span>
              <span className={`tabular-nums ${c.key === coll ? "text-[#CFE0D6]" : "text-mute"}`}>{c.count}</span>
            </button>
          ))}
          {!colls && <p className="p-3 text-sm text-mute">載入中…</p>}
        </nav>
      </section>

      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">
            {label} <span className="text-sm font-normal text-mute">（{coll}，共 {data?.total ?? "…"} 筆）</span>
          </h2>
          <form
            role="search"
            className="relative w-full max-w-xs"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q.trim());
              setPage(1);
            }}
          >
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute">
              <Icon name="search" size={16} />
            </span>
            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="搜尋（按 Enter）" aria-label="搜尋資料" className={`${inputCls} pl-9`} />
          </form>
        </div>
        <ErrorBar messages={[result?.key === key ? result.error : ""]} />
        <Table head={["ID", "說明", "欄位數", ""]}>
          {data?.rows.map((r) => (
            <tr key={r.id} className="hover:bg-[#FAFBF8]">
              <Td className="font-mono text-xs text-mute">{r.id}</Td>
              <Td>{r.summary || <span className="text-mute">—</span>}</Td>
              <Td className="text-mute">{r.fields}</Td>
              <Td className="whitespace-nowrap text-right">
                <button type="button" className={smallBtn()} onClick={() => setViewing(r)}>
                  <Icon name="eye" size={14} /> 檢視
                </button>
                <button type="button" className={smallBtn("danger")} onClick={() => askDelete(r)} aria-label={`刪除 ${r.id}`}>
                  <Icon name="trash" size={14} />
                </button>
              </Td>
            </tr>
          ))}
          {(loading || !data?.rows.length) && (
            <tr>
              <Td colSpan={4} className="py-8 text-center text-mute">
                {loading ? "載入中…" : search ? "沒有符合的資料" : "這個集合沒有資料"}
              </Td>
            </tr>
          )}
        </Table>
        {data && data.pages > 1 && (
          <div className="mt-3 flex items-center justify-center gap-3 text-sm">
            <button type="button" className={btn()} disabled={page <= 1} onClick={() => setPage(page - 1)}>
              上一頁
            </button>
            <span className="tabular-nums text-ink2">
              {data.page} / {data.pages}
            </span>
            <button type="button" className={btn()} disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
              下一頁
            </button>
          </div>
        )}
        <p className="mt-3 text-xs text-mute">
          要修改內容請到各功能頁面操作；這裡只提供檢視與刪除。刪除 LINE 好友會一併刪除他的對話紀錄與訂單草稿，ll3 訂單系統裡的訂單不受影響。
        </p>
      </div>

      {viewing && (
        <Modal
          wide
          onClose={() => setViewing(null)}
          title={`${label}：${viewing.summary || viewing.id}`}
          footer={
            <>
              <button type="button" className={`${dangerBtn} mr-auto`} onClick={() => askDelete(viewing)}>
                <Icon name="trash" size={15} /> 刪除這筆
              </button>
              <button type="button" className={btn()} onClick={() => setViewing(null)}>
                關閉
              </button>
            </>
          }
        >
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-white p-4 font-mono text-xs ring-1 ring-line">{JSON.stringify(viewing.doc, null, 2)}</pre>
        </Modal>
      )}
      {gate.dialog}
    </div>
  );
}
