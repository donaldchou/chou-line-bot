"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { isUnlocked, lock, unlock, useUnlock } from "./me";
import { btn, card } from "./ui";

/* 後台管理用的元件（照 chou-platform 的 Modal / Tabs / Table / 驗證碼對話框 / 解鎖區塊） */

export const inputCls =
  "min-h-10 w-full rounded-[10px] border border-field bg-white px-3 text-sm outline-none focus:border-leaf disabled:bg-ground disabled:text-mute";

export type CodeResult = { ok: true } | { ok: false; error: string };
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 呼叫後台管理 API；code 放在 x-verify-code header（中文用 encodeURIComponent） */
export async function call<T>(url: string, init?: RequestInit & { code?: string; json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(init?.code !== undefined ? { "x-verify-code": encodeURIComponent(init.code) } : {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
  }
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status, data });
  return data as T;
}

export function PageHeader({ title, desc, children }: { title: string; desc?: string; children?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end gap-3">
      <div className="mr-auto flex flex-col gap-1">
        <h1 className="text-[26px] font-bold">{title}</h1>
        {desc && <p className="max-w-3xl text-sm text-mute">{desc}</p>}
      </div>
      {children}
    </header>
  );
}

export function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={`${card} px-5 py-4`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm font-bold ${className ?? ""}`}>
      {label}
      {children}
      {hint && <span className="text-xs font-normal">{hint}</span>}
    </label>
  );
}

export function Modal({
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`flex max-h-[95vh] w-full flex-col rounded-t-2xl bg-ground shadow-xl sm:rounded-2xl ${wide ? "sm:max-w-4xl" : "sm:max-w-xl"}`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-mute hover:bg-line" aria-label="關閉">
            <Icon name="x" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-[#E4E8E1] p-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={`min-h-10 whitespace-nowrap rounded-lg px-4 text-sm font-bold ${value === t.value ? "bg-white text-leaf shadow-sm" : "text-ink2 hover:text-ink"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-[#FAFBF8] text-left text-[13px] text-mute">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3.5 py-2.5 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line2">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={`px-3.5 py-2.5 align-middle ${className ?? ""}`}>
    {children}
  </td>
);

export const smallBtn = (tone: "plain" | "danger" | "pri" = "plain") =>
  `inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-bold disabled:opacity-50 ${
    tone === "danger" ? "text-[#B3261E] hover:bg-[#FDECEA]" : tone === "pri" ? "text-leaf hover:bg-[#E6F2EB]" : "text-ink2 hover:bg-ground"
  }`;
export const dangerBtn =
  "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-[#B3261E] bg-[#B3261E] px-4 text-sm font-bold text-white hover:bg-[#931f18] disabled:opacity-50";

/* ---------------- 驗證碼對話框 ---------------- */

interface CodeAsk {
  title: string;
  confirmLabel: string;
  danger?: boolean;
  message: ReactNode;
  /** 檢查驗證碼並執行動作；成功時對話框會自動關閉 */
  submit: (code: string) => Promise<CodeResult>;
  onCancel?: () => void;
}

/** 需要驗證碼才能做的動作：ask(...) 跳出對話框，把 dialog 放進畫面裡 */
export function useCodeGate() {
  const [ask, setAsk] = useState<CodeAsk | null>(null);
  const dialog = ask && (
    <CodeModal
      ask={ask}
      onClose={() => {
        ask.onCancel?.();
        setAsk(null);
      }}
      onDone={() => setAsk(null)}
    />
  );
  return { ask: setAsk, dialog };
}

function CodeModal({ ask, onClose, onDone }: { ask: CodeAsk; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 解鎖期間不用輸入：一般操作直接送出；刪除仍顯示確認。失敗（例如剛好到期）才改回輸入。
  const [skip, setSkip] = useState(isUnlocked);
  const auto = skip && !ask.danger;
  const askRef = useRef(ask);
  const started = useRef(false);

  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    void askRef.current.submit("").then((res) => {
      if (res.ok) return onDone();
      setSkip(false);
      setError(res.error);
    });
  }, [auto, onDone]);

  if (auto) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!skip && !code.trim()) return setError("請輸入驗證碼");
    setBusy(true);
    setError("");
    const res = await ask.submit(skip ? "" : code.trim());
    setBusy(false);
    if (res.ok) return onDone();
    setSkip(false);
    setError(res.error);
    setCode("");
  }

  return (
    <Modal
      onClose={onClose}
      title={ask.title}
      footer={
        <>
          <button type="button" className={btn()} onClick={onClose}>
            取消
          </button>
          <button type="submit" form="code-form" disabled={busy} className={ask.danger ? dangerBtn : btn("pri")}>
            {busy ? "處理中…" : ask.confirmLabel}
          </button>
        </>
      }
    >
      <form id="code-form" onSubmit={submit} className="flex flex-col gap-4">
        <div className={`flex gap-3 rounded-lg p-3 text-sm ${ask.danger ? "bg-[#FDECEA] text-[#7A1E16]" : "bg-[#FFF4E0] text-[#6B3E00]"}`}>
          <Icon name="alert" />
          <div>{ask.message}</div>
        </div>
        {skip ? (
          <p className="text-sm text-leaf">驗證碼已在後台解鎖，這次不需輸入。</p>
        ) : (
          <Field label="請輸入驗證碼" hint={error && <span className="font-bold text-[#B3261E]">{error}</span>}>
            <input
              type="password"
              autoFocus
              autoComplete="off"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError("");
              }}
              className={inputCls}
            />
          </Field>
        )}
      </form>
    </Modal>
  );
}

/* ---------------- 驗證碼解鎖 ---------------- */

/** 每秒更新的剩餘秒數 */
export function useRemaining(until: number | null) {
  // 一開始是 0（伺服器預先產生畫面時不能讀現在時間），掛上後馬上更新
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!until) return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [until]);
  return until && now ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

/** 倒數：1 小時以上顯示 時:分:秒，否則 分:秒 */
export const mmss = (s: number) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ""}${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

const HOURS_MIN = 1;
const HOURS_MAX = 12;

/** 後台管理的解鎖區塊：時數只能用 − ＋ 調整（1–12 小時，預設 1） */
export function UnlockPanel() {
  const until = useUnlock();
  const left = useRemaining(until);
  const [hours, setHours] = useState(HOURS_MIN);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const unlocked = !!until && left > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return setError("請輸入驗證碼");
    setBusy(true);
    setError("");
    const res = await unlock(code.trim(), hours);
    setBusy(false);
    setCode("");
    if (!res.ok) setError(res.error);
  }

  return (
    <div className={`mb-5 rounded-xl border p-4 ${unlocked ? "border-[#B7DEC6] bg-[#EEF7F1]" : "border-[#F0D9A8] bg-[#FFF8EA]"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Icon name={unlocked ? "lockOpen" : "lock"} size={22} className={unlocked ? "text-leaf" : "text-[#8A4B00]"} />
          <div>
            <div className="font-bold">驗證碼解鎖</div>
            <div className="text-sm text-ink2">
              {unlocked ? (
                <>
                  已解鎖，後台的新增／修改／刪除都不用輸入驗證碼，<b className="tabular-nums">{mmss(left)}</b> 後失效。
                </>
              ) : (
                `輸入一次驗證碼，${hours} 小時內後台的新增／修改／刪除都不用再輸入。`
              )}
            </div>
          </div>
        </div>
        {unlocked ? (
          <button type="button" className={btn()} onClick={() => void lock()}>
            立即鎖定
          </button>
        ) : (
          <form onSubmit={submit} className="flex flex-wrap items-start gap-2">
            <div className="flex h-11 items-center rounded-[10px] border border-field bg-white" role="group" aria-label="解鎖時數">
              <button
                type="button"
                aria-label="減少 1 小時"
                disabled={hours <= HOURS_MIN}
                onClick={() => setHours((h) => Math.max(HOURS_MIN, h - 1))}
                className="flex h-full w-10 items-center justify-center rounded-l-[10px] text-ink2 hover:bg-ground disabled:text-field"
              >
                <Icon name="minus" size={16} />
              </button>
              <span className="min-w-16 select-none text-center text-sm font-bold tabular-nums" aria-live="polite">
                {hours} 小時
              </span>
              <button
                type="button"
                aria-label="增加 1 小時"
                disabled={hours >= HOURS_MAX}
                onClick={() => setHours((h) => Math.min(HOURS_MAX, h + 1))}
                className="flex h-full w-10 items-center justify-center rounded-r-[10px] text-ink2 hover:bg-ground disabled:text-field"
              >
                <Icon name="plus" size={16} />
              </button>
            </div>
            <div>
              <input
                type="password"
                autoComplete="off"
                placeholder="請輸入驗證碼"
                aria-label="驗證碼"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setError("");
                }}
                className={`${inputCls} min-h-11 w-44`}
              />
              {error && <div className="mt-1 text-xs font-bold text-[#B3261E]">{error}</div>}
            </div>
            <button type="submit" disabled={busy} className={btn("pri")}>
              {busy ? "驗證中…" : `解鎖 ${hours} 小時`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
