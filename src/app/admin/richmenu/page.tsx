"use client";

import { useEffect, useState } from "react";
import {
  cellLetter,
  cells,
  CHAT_BAR_MAX,
  HISTORY_KEEP,
  isLayout,
  LAYOUT_KEYS,
  LAYOUTS,
  layoutLabel,
  MAX_MENU_IMAGE,
  NAME_MAX,
  qaKey,
  type AreaAction,
  type LayoutKey,
  type MenuPageData,
  type MenuView,
} from "@/lib/richmenu-layout";
import { Icon } from "../_ui/icons";
import { call, Card, errMsg, Field, inputCls, Modal, PageHeader, smallBtn, UnlockTimer, useGatedAction } from "../_ui/kit";
import { useMe } from "../_ui/me";
import { btn, card, ErrorBar, mdhm, usePoll } from "../_ui/ui";

/* 後台「圖文選單」：換 LINE 聊天室下方的選單圖片、設定每一格按下去做什麼（只有管理者） */

const imgSrc = (name: string) => `/api/admin/richmenu/image?n=${name}`;

type Img = { name: string | null; file: File | null; url: string; width: number; height: number; kb: number; fileName: string };
type Form = { layout: LayoutKey; name: string; areas: AreaAction[]; chatBarText: string; selected: boolean; image: Img | null };

const blankForm = (): Form => ({ layout: "small6", name: "", areas: cells("small6").map(() => ({ type: "message", value: "" })), chatBarText: "選單", selected: true, image: null });

/** 以某個選單為底（版型對不上的自訂格子：只帶圖片以外的設定） */
function formFrom(m: MenuView): Form {
  const layout = isLayout(m.layout) ? m.layout : "small6";
  const n = cells(layout).length;
  return {
    layout,
    name: m.name,
    areas: Array.from({ length: n }, (_, i) => (m.areas[i] ? { type: m.areas[i].type, value: m.areas[i].value } : { type: "message", value: "" })),
    chatBarText: m.chatBarText,
    selected: m.selected,
    image: isLayout(m.layout) ? { name: m.image, file: null, url: imgSrc(m.image), width: m.width, height: m.height, kb: 0, fileName: "" } : null,
  };
}

async function uploadImage(file: File, code: string) {
  const res = await fetch("/api/admin/richmenu/image", {
    method: "POST",
    body: file,
    headers: { "content-type": file.type || "application/octet-stream", "x-verify-code": encodeURIComponent(code) },
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.name) throw new Error(d.error ?? `圖片上傳失敗（HTTP ${res.status}）`);
  return d.name as string;
}

const readSize = (url: string) =>
  new Promise<{ width: number; height: number }>((ok, fail) => {
    const im = new Image();
    im.onload = () => ok({ width: im.naturalWidth, height: im.naturalHeight });
    im.onerror = () => fail(new Error("讀不到這張圖片"));
    im.src = url;
  });

export default function RichMenuPage() {
  const me = useMe();
  // 等使用者用 LINE 傳綁定號碼時，每 4 秒重新抓一次
  const [fast, setFast] = useState(false);
  const { data: d, error, reload } = usePoll<MenuPageData>(me?.role === "admin" ? "/api/admin/richmenu" : null, fast ? 4000 : 60_000);
  const [form, setForm] = useState<Form | null>(null);
  const gated = useGatedAction();
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  /** 點圖放大的選單 */
  const [zoom, setZoom] = useState<MenuView | null>(null);
  // 成功訊息幾秒後自動消失（錯誤要按關閉）
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 8000);
    return () => clearTimeout(t);
  }, [msg]);
  /** 操作結果：顯示在畫面下方（按鈕在頁面下面，頁面上方的訊息看不到） */
  const note = (text: string, isError = false) => {
    setErr(isError ? text : "");
    setMsg(isError ? "" : text);
  };

  if (me && me.role !== "admin") {
    return (
      <main className="px-4 pt-10">
        <p className={`${card} mx-auto max-w-lg p-8 text-center`}>圖文選單只有管理者可以使用。</p>
      </main>
    );
  }

  // 還沒動過表單：以目前使用中的選單為底
  const f: Form = form ?? (d?.active ? formFrom(d.active) : blankForm());
  const L = LAYOUTS[f.layout];
  const pos = cells(f.layout);
  const imgOk = !!f.image && f.image.width === L.width && f.image.height === L.height;
  const waitingBind = !!d && !d.me.bound && !!d.me.bindCode;
  if (fast !== waitingBind) setFast(waitingBind);

  const update = (patch: Partial<Form>) => {
    setForm({ ...f, ...patch });
    setMsg("");
  };
  const setLayout = (layout: LayoutKey) => {
    const n = cells(layout).length;
    update({ layout, areas: Array.from({ length: n }, (_, i) => f.areas[i] ?? { type: "message", value: "" }) });
  };
  const setArea = (i: number, patch: Partial<AreaAction>) => update({ areas: f.areas.map((a, k) => (k === i ? { ...a, ...patch } : a)) });

  async function pickFile(file: File | undefined) {
    setErr("");
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) return setErr("只收 PNG 或 JPG 圖片");
    if (file.size > MAX_MENU_IMAGE) return setErr(`圖片 ${Math.ceil(file.size / 1024)} KB，LINE 規定要 1MB 以下`);
    const url = URL.createObjectURL(file);
    try {
      const s = await readSize(url);
      update({ image: { name: null, file, url, ...s, kb: Math.ceil(file.size / 1024), fileName: file.name } });
    } catch (e) {
      setErr(errMsg(e));
    }
  }

  /** 送出前在畫面上先檢查一次（後端還會再檢查） */
  function check() {
    if (!f.image) return "請上傳圖片";
    if (!imgOk) return `圖片是 ${f.image.width} × ${f.image.height}，${L.label}要 ${L.width} × ${L.height}`;
    const empty = f.areas.findIndex((a) => !a.value.trim());
    if (empty >= 0) return `${cellLetter(empty)} 格還沒填內容`;
    const badUri = f.areas.findIndex((a) => a.type === "uri" && !/^https?:\/\/\S+$/.test(a.value.trim()));
    if (badUri >= 0) return `${cellLetter(badUri)} 格的網址要以 https:// 開頭`;
    if (!f.chatBarText.trim()) return "請填選單列文字";
    return "";
  }

  /** 需要驗證碼的動作；圖片還沒傳到 ll3 的先傳 */
  async function send(action: "test" | "apply") {
    const problem = check();
    if (problem) return note(problem, true);
    note("");
    const done = await gated.run({
      title: action === "test" ? "傳到我的 LINE 試看看" : "換上 LINE（所有客人）",
      confirmLabel: action === "test" ? "傳到我的 LINE" : "換上 LINE",
      message:
        action === "test"
          ? `新選單只會出現在你綁定的 LINE（${d?.me.lineName || "你的手機"}），客人還是看到目前的選單。`
          : "所有客人的圖文選單會馬上換成這一個。",
      action: async (code) => {
        setBusy(action);
        try {
          let name = f.image!.name;
          if (!name) {
            name = await uploadImage(f.image!.file!, code);
            setForm({ ...f, image: { ...f.image!, name } });
          }
          await call("/api/admin/richmenu", {
            method: "POST",
            code,
            json: { action, layout: f.layout, name: f.name, areas: f.areas, chatBarText: f.chatBarText, selected: f.selected, image: name },
          });
          await reload();
        } finally {
          setBusy("");
        }
      },
    });
    if (done)
      note(
        action === "test"
          ? "✓ 已傳到你的 LINE。打開周家農場的聊天室看看（沒出現的話關掉聊天室再打開）。"
          : "✓ 已換上 LINE，所有客人都會看到新的選單。上面「目前使用中」已經更新。",
      );
  }

  async function gatedSimple(o: { key: string; title: string; message: string; confirmLabel: string; danger?: boolean; json: Record<string, unknown>; ok: string }) {
    note("");
    const done = await gated.run({
      title: o.title,
      message: o.message,
      confirmLabel: o.confirmLabel,
      danger: o.danger,
      action: async (code) => {
        setBusy(o.key);
        try {
          await call("/api/admin/richmenu", { method: "POST", code, json: o.json });
          await reload();
        } finally {
          setBusy("");
        }
      },
    });
    if (done) note(o.ok);
  }

  /** 不需要驗證碼的動作：綁定、解除綁定、結束試看 */
  async function plain(action: string, ok = "") {
    setBusy(action);
    note("");
    try {
      await call("/api/admin/richmenu", { method: "POST", json: { action } });
      await reload();
      if (ok) note(ok);
    } catch (e) {
      note(errMsg(e), true);
    } finally {
      setBusy("");
    }
  }

  const describe = (a: AreaAction) => {
    if (a.type === "uri") return a.value.trim() ? { text: "打開網頁", tone: "ok" } : null;
    const k = qaKey(a.value);
    if (!k || !d) return null;
    const c = d.commands.find((c) => qaKey(c.text) === k);
    if (c) return { text: `固定回覆：${c.desc}`, tone: "ok" };
    const q = d.qas.find((q) => qaKey(q) === k);
    if (q) return { text: "問答：回答＋照片", tone: "ok" };
    return { text: "交給 AI 回答", tone: "ai" };
  };

  return (
    <main className="px-4 pb-10 pt-5 md:px-8 md:pt-7">
      <PageHeader title="圖文選單" desc="客人在 LINE 聊天室下方看到的按鈕。在這裡換圖片、改每個按鈕按下去要做什麼。只有管理者看得到這一頁。" badge={<UnlockTimer />} />
      <ErrorBar messages={[error, d?.lineError]} />
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 lg:pl-[264px]">
        {(busy === "test" || busy === "apply" || busy === "disable" || busy.startsWith("restore:") || busy.startsWith("delete:")) && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white shadow-xl">
            <Spinner />
            {busy === "test"
              ? "正在傳到你的 LINE…（約 5～10 秒）"
              : busy === "disable"
                ? "正在停用…"
                : busy.startsWith("delete:")
                  ? "正在刪除…"
                  : "正在換上 LINE…（約 5～10 秒）"}
          </div>
        )}
        {!busy && (msg || err) && (
          <div
            role={err ? "alert" : "status"}
            className={`pointer-events-auto flex max-w-2xl items-start gap-3 rounded-xl px-5 py-3 text-sm shadow-xl ${err ? "bg-[#B3261E] text-white" : "bg-[#17613E] text-white"}`}
          >
            <span className="font-bold">{err ? `沒有成功：${err}` : msg}</span>
            <button type="button" aria-label="關閉" onClick={() => note("")} className="-mr-2 rounded p-0.5 hover:bg-white/20">
              <Icon name="x" size={18} />
            </button>
          </div>
        )}
      </div>

      <div className="flex max-w-5xl flex-col gap-5">
        {d?.test && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#F0D9A8] bg-[#FFF8EA] px-4 py-3 text-sm text-[#6B3E00]">
            <Icon name="phone" />
            <div className="mr-auto">
              你的手機正在試看「<b>{d.test.name}</b>」：只有你看得到，客人還是看到目前使用中的選單。
            </div>
            <button type="button" className={btn()} disabled={busy === "endTest"} onClick={() => void plain("endTest", "已結束試看，你的手機會改回看到目前使用中的選單。")}>
              結束試看
            </button>
          </div>
        )}

        <Card
          title="目前使用中"
          action={
            d?.active && (
              <button type="button" className={btn()} onClick={() => (setForm(formFrom(d.active!)), setMsg(""), document.getElementById("new-menu")?.scrollIntoView({ behavior: "smooth" }))}>
                <Icon name="edit" size={16} /> 以這個為底，改一份新的
              </button>
            )
          }
        >
          {!d ? (
            <p className="py-4 text-sm text-mute">讀取中…</p>
          ) : d.active ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start gap-5">
                <MenuImage m={d.active} className="w-full max-w-[520px] flex-[1_1_380px]" onOpen={() => setZoom(d.active)} />
                <dl className="grid flex-[1_1_240px] grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-mute">名稱</dt>
                  <dd>{d.active.name}</dd>
                  <dt className="text-mute">版型</dt>
                  <dd>
                    {layoutLabel(d.active.layout)}（{d.active.width} × {d.active.height}）
                  </dd>
                  <dt className="text-mute">選單列文字</dt>
                  <dd>{d.active.chatBarText}</dd>
                  <dt className="text-mute">換上時間</dt>
                  <dd>{mdhm(d.active.appliedAt)}</dd>
                  <dt className="text-mute">換上的人</dt>
                  <dd>{d.active.appliedBy}</dd>
                </dl>
              </div>
              <AreaList m={d.active} />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line2 pt-3">
                <p className="text-sm text-mute">停用後，客人會自動改回看到你在 LINE 官方帳號後台設定的選單。</p>
                <button
                  type="button"
                  className={`${smallBtn("danger")} min-h-11 border border-line px-3.5`}
                  disabled={!!busy}
                  onClick={() =>
                    void gatedSimple({
                      key: "disable",
                      title: "停用圖文選單",
                      message: "停用後，所有客人會改看到 LINE 官方帳號後台設定的選單（後台沒有設定的話就沒有選單）。這個選單會留在下面「換過的選單」，可以再換回來。",
                      confirmLabel: "停用",
                      danger: true,
                      json: { action: "disable" },
                      ok: "已停用，客人會改看到 LINE 官方帳號後台設定的選單。",
                    })
                  }
                >
                  {busy === "disable" ? "停用中…" : "停用，改回 LINE 後台的選單"}
                </button>
              </div>
            </div>
          ) : (
            <p className="py-2 text-sm text-ink2">目前用的是 LINE 官方帳號後台設定的選單（這裡看不到，要到 LINE 官方帳號後台修改）。在下面換上新選單後，會蓋過後台設定的那一個。</p>
          )}
        </Card>

        <section id="new-menu" aria-labelledby="new-h" className={`${card} flex flex-col gap-7 px-5 py-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="new-h" className="text-lg font-bold">
              換新選單
            </h2>
            {form && (
              <button type="button" className={smallBtn()} onClick={() => (setForm(null), setErr(""), setMsg(""))}>
                <Icon name="undo" size={15} /> 重來（回到目前使用中的設定）
              </button>
            )}
          </div>

          <Step n={1} title="選版型">
            <div role="radiogroup" aria-label="版型" className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
              {LAYOUT_KEYS.map((k) => {
                const on = f.layout === k;
                const l = LAYOUTS[k];
                return (
                  <label key={k} className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-3 ${on ? "border-2 border-leaf bg-[#F3F9F5] p-[11px]" : "border-field hover:bg-ground"}`}>
                    <span
                      aria-hidden="true"
                      className="grid gap-[3px] rounded-md bg-line p-[3px]"
                      style={{ gridTemplateColumns: `repeat(${l.cols}, minmax(0, 1fr))`, aspectRatio: `${l.width} / ${l.height}` }}
                    >
                      {cells(k).map((_, i) => (
                        <span key={i} className="rounded-[3px] bg-white" />
                      ))}
                    </span>
                    <span className="flex items-center gap-2 text-[15px] font-bold">
                      <input type="radio" name="layout" checked={on} onChange={() => setLayout(k)} />
                      {l.label}
                    </span>
                    <span className="text-xs text-mute">
                      {l.width} × {l.height}
                      {d?.active?.layout === k ? "・目前使用" : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          </Step>

          <Step n={2} title="上傳圖片">
            <p className="text-sm text-mute">
              圖片要剛好 {L.width} × {L.height} 像素，PNG 或 JPG，1MB 以下。橘色虛線是每一格的位置，請對一下有沒有對到圖上的按鈕。
            </p>
            <div className="flex flex-wrap items-start gap-5">
              <div className="relative w-full max-w-[620px] flex-[1_1_400px]">
                {f.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.image.url} alt="新選單圖片預覽" className="block w-full rounded-lg border border-line" />
                ) : (
                  <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-field bg-ground text-sm text-mute" style={{ aspectRatio: `${L.width} / ${L.height}` }}>
                    還沒選圖片
                  </div>
                )}
                <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                  {pos.map((p, i) => (
                    <span
                      key={i}
                      className="absolute border-2 border-dashed border-[#E8590C]"
                      style={{ left: `${(p.x / L.width) * 100}%`, top: `${(p.y / L.height) * 100}%`, width: `${(p.w / L.width) * 100}%`, height: `${(p.h / L.height) * 100}%` }}
                    >
                      <span className="absolute left-0 top-0 rounded-br-md bg-[#E8590C] px-2 text-[13px] font-black text-white">{cellLetter(i)}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-[1_1_220px] flex-col gap-2 text-sm">
                {f.image &&
                  (imgOk ? (
                    <div className="font-bold text-leaf">
                      ✓ 尺寸正確 {f.image.width} × {f.image.height}
                    </div>
                  ) : (
                    <div className="font-bold text-[#B3261E]">
                      圖片是 {f.image.width} × {f.image.height}，{L.label}要 {L.width} × {L.height}
                    </div>
                  ))}
                {f.image?.kb ? <div className="font-bold text-leaf">✓ {f.image.kb} KB（1MB 以下）</div> : null}
                {f.image?.fileName && <div className="break-all text-mute">{f.image.fileName}</div>}
                {f.image && !f.image.file && <div className="text-mute">沿用目前選單的圖片</div>}
                <label className={`${btn()} cursor-pointer self-start`}>
                  <Icon name="upload" size={16} /> {f.image ? "重新選擇圖片" : "選擇圖片"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="sr-only"
                    onChange={(e) => {
                      void pickFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
          </Step>

          <Step n={3} title="每一格按下去做什麼">
            <p className="text-sm text-mute">「傳送文字」是幫客人送出一句話。文字跟機器人認得的一樣，才會有固定回覆；在框裡可以直接挑。</p>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <thead>
                  <tr className="bg-[#FAFBF8] text-left text-[13px] text-mute">
                    <th scope="col" className="w-14 px-3.5 py-2.5">
                      格子
                    </th>
                    <th scope="col" className="w-40 px-3.5 py-2.5">
                      動作
                    </th>
                    <th scope="col" className="px-3.5 py-2.5">
                      內容
                    </th>
                    <th scope="col" className="w-48 px-3.5 py-2.5">
                      客人會收到
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line2">
                  {f.areas.map((a, i) => {
                    const info = describe(a);
                    return (
                      <tr key={i}>
                        <td className="px-3.5 py-2 font-black text-[#C2410C]">{cellLetter(i)}</td>
                        <td className="px-3.5 py-2">
                          <select aria-label={`${cellLetter(i)} 格動作`} value={a.type} onChange={(e) => setArea(i, { type: e.target.value as AreaAction["type"] })} className={inputCls}>
                            <option value="message">傳送文字</option>
                            <option value="uri">開啟網址</option>
                          </select>
                        </td>
                        <td className="px-3.5 py-2">
                          <input
                            aria-label={`${cellLetter(i)} 格${a.type === "uri" ? "網址" : "文字"}`}
                            type={a.type === "uri" ? "url" : "text"}
                            list={a.type === "uri" ? undefined : "menu-texts"}
                            placeholder={a.type === "uri" ? "https://" : "例如：我要訂購"}
                            value={a.value}
                            onChange={(e) => setArea(i, { value: e.target.value })}
                            className={inputCls}
                          />
                        </td>
                        <td className={`px-3.5 py-2 text-[13px] ${info?.tone === "ai" ? "text-[#8A4B00]" : "text-leaf"}`}>{info?.text ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <datalist id="menu-texts">
              {d?.commands.map((c) => <option key={c.text} value={c.text} label={`固定回覆：${c.desc}`} />)}
              {d?.qas.map((q) => <option key={q} value={q} label="問答" />)}
            </datalist>
            <p className="text-xs text-mute">「交給 AI 回答」不是錯誤，只是機器人會用 AI 理解這句話再回答，每次的回答可能不一樣。</p>
          </Step>

          <Step n={4} title="其他設定">
            <div className="flex flex-wrap items-end gap-5">
              <Field label={`名稱（自己看的，最多 ${NAME_MAX} 字）`} className="w-64">
                <input value={f.name} maxLength={NAME_MAX} placeholder={L.label} onChange={(e) => update({ name: e.target.value })} className={`${inputCls} min-h-11`} />
              </Field>
              <Field label={`選單列文字（最多 ${CHAT_BAR_MAX} 字）`} className="w-56">
                <input value={f.chatBarText} maxLength={CHAT_BAR_MAX} onChange={(e) => update({ chatBarText: e.target.value })} className={`${inputCls} min-h-11`} />
              </Field>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={f.selected} onChange={(e) => update({ selected: e.target.checked })} className="h-[18px] w-[18px]" />
                客人打開聊天室時，選單自動展開
              </label>
            </div>
          </Step>

          <div className="flex flex-col gap-3 border-t border-line2 pt-5">
            <BindBox d={d} busy={busy} plain={plain} />
            <div className="flex flex-wrap items-center justify-end gap-3">
              <p className="mr-auto flex-[1_1_280px] text-sm text-mute">建議先「傳到我的 LINE」試按每一格，沒問題再換上給所有客人。</p>
              <button
                type="button"
                className={`${btn()} border-leaf text-leaf`}
                disabled={!d?.me.bound || !!busy}
                onClick={() => void send("test")}
                title={d?.me.bound ? undefined : "請先綁定你的 LINE"}
              >
                {busy === "test" ? <Spinner /> : <Icon name="phone" size={16} />} {busy === "test" ? "傳送中…" : "傳到我的 LINE 試看看"}
              </button>
              <button type="button" className={btn("pri")} disabled={!!busy} onClick={() => void send("apply")}>
                {busy === "apply" ? (
                  <>
                    <Spinner /> 換上中…
                  </>
                ) : (
                  "換上 LINE（所有客人）"
                )}
              </button>
            </div>
          </div>
        </section>

        <Card title="換過的選單" action={<span className="text-xs text-mute">最多留 {HISTORY_KEEP} 個，多的和刪除的會移到「後台管理 › 已刪除紀錄」</span>}>
          {!d?.history.length ? (
            <p className="py-2 text-sm text-mute">還沒有。以後換掉的選單會留在這裡（最近 {HISTORY_KEEP} 個），一鍵就能換回去。</p>
          ) : (
            <div className="flex flex-col gap-3">
              {d.history.map((h) => (
                <div key={h.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-line2 p-3">
                  <MenuImage m={h} className="w-[180px]" onOpen={() => setZoom(h)} />
                  <div className="min-w-0 flex-[1_1_200px]">
                    <div className="font-bold">{h.name}</div>
                    <div className="text-[13px] text-mute">
                      {layoutLabel(h.layout)}・{mdhm(h.appliedAt)} 換上・{h.appliedBy}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={smallBtn()} onClick={() => (setForm(formFrom(h)), setMsg(""), document.getElementById("new-menu")?.scrollIntoView({ behavior: "smooth" }))}>
                      以這個為底
                    </button>
                    <button
                      type="button"
                      className={`${btn()} border-leaf text-leaf`}
                      disabled={!!busy}
                      onClick={() =>
                        void gatedSimple({
                          key: `restore:${h.id}`,
                          title: "換回這個選單",
                          message: `所有客人的圖文選單會馬上換回「${h.name}」。`,
                          confirmLabel: "換回",
                          json: { action: "restore", id: h.id },
                          ok: `✓ 已換回「${h.name}」，所有客人都會看到這個選單。`,
                        })
                      }
                    >
                      {busy === `restore:${h.id}` ? (
                        <>
                          <Spinner /> 換回中…
                        </>
                      ) : (
                        "換回這個"
                      )}
                    </button>
                    <button
                      type="button"
                      className={`${smallBtn("danger")} min-h-11`}
                      disabled={!!busy}
                      aria-label={`刪除「${h.name}」`}
                      onClick={() =>
                        void gatedSimple({
                          key: `delete:${h.id}`,
                          title: "刪除這個選單",
                          message: `確定要刪除「${h.name}」（${mdhm(h.appliedAt)} 換上）嗎？會移到「後台管理 › 已刪除紀錄」，需要時可以從那裡還原。`,
                          confirmLabel: "刪除",
                          danger: true,
                          json: { action: "delete", id: h.id },
                          ok: `✓ 已刪除「${h.name}」，移到後台管理的「已刪除紀錄」。`,
                        })
                      }
                    >
                      {busy === `delete:${h.id}` ? <Spinner /> : <Icon name="trash" size={16} />} 刪除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      {zoom && (
        <Modal wide title={zoom.name} onClose={() => setZoom(null)}>
          <div className="flex flex-col gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgSrc(zoom.image)} alt={`圖文選單：${zoom.areas.map((a) => a.value).join("、")}`} className="block w-full rounded-lg border border-line" />
            <p className="text-sm text-mute">
              {layoutLabel(zoom.layout)}（{zoom.width} × {zoom.height}）・選單列文字「{zoom.chatBarText}」・{mdhm(zoom.appliedAt)} 換上・{zoom.appliedBy}
            </p>
            <AreaList m={zoom} />
          </div>
        </Modal>
      )}
      {gated.dialog}
    </main>
  );
}

function Spinner() {
  return <span aria-hidden="true" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2.5 text-[17px] font-bold">
        <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full bg-forest text-sm text-white">{n}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

/** 選單圖片；有 onOpen 時可以點開放大 */
function MenuImage({ m, className, onOpen }: { m: MenuView; className?: string; onOpen?: () => void }) {
  const alt = `圖文選單：${m.areas.map((a) => a.value).join("、")}`;
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src={imgSrc(m.image)} alt={alt} className="block w-full rounded-lg border border-line" />;
  if (!onOpen) return <div className={className}>{img}</div>;
  return (
    <button type="button" onClick={onOpen} title="點一下放大" aria-label={`放大「${m.name}」`} className={`group relative cursor-zoom-in ${className ?? ""}`}>
      {img}
      <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white opacity-80 group-hover:opacity-100">
        <Icon name="search" size={12} /> 放大
      </span>
    </button>
  );
}

function AreaList({ m }: { m: MenuView }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-5 gap-y-1.5 text-sm">
      {m.areas.map((a, i) => (
        <li key={i} className="flex min-w-0 gap-2">
          <b className="text-[#C2410C]">{cellLetter(i)}</b>
          <span className="text-mute">{a.type === "uri" ? "開網址" : "傳送"}</span>
          <span className="truncate" title={a.value}>
            {a.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

function BindBox({ d, busy, plain }: { d: MenuPageData | null; busy: string; plain: (action: string, ok?: string) => Promise<void> }) {
  if (!d) return null;
  if (d.me.bound)
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink2">
        <Icon name="phone" size={16} className="text-leaf" />
        試看會傳到你綁定的 LINE：<b>{d.me.lineName || "（沒有名稱）"}</b>
        <button type="button" className={smallBtn()} disabled={busy === "unbind"} onClick={() => void plain("unbind", "已解除綁定。")}>
          解除綁定
        </button>
      </div>
    );
  if (d.me.bindCode)
    return (
      <div className="rounded-xl border border-[#B7DEC6] bg-[#EEF7F1] px-4 py-3 text-sm text-[#17613E]">
        請用你的手機 LINE，傳這句話給「周家農場」官方帳號：
        <div className="my-2 text-2xl font-black tracking-wider text-ink">綁定 {d.me.bindCode}</div>
        10 分鐘內有效（{mdhm(d.me.bindExp)} 前）。傳出後這裡會自動顯示「已綁定」。
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#F0D9A8] bg-[#FFF8EA] px-4 py-3 text-sm text-[#6B3E00]">
      <span className="mr-auto">要先綁定你的 LINE，才能「傳到我的 LINE 試看看」。</span>
      <button type="button" className={btn()} disabled={busy === "bind"} onClick={() => void plain("bind")}>
        綁定我的 LINE
      </button>
    </div>
  );
}
