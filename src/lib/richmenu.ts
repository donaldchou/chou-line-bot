import { randomBytes, randomInt } from "node:crypto";
import { HttpError, type PublicUser } from "./auth";
import { connectDB } from "./mongodb";
import { AdminUser, QaItem, RichMenu, type RichMenuDoc } from "./models";
import { MENU_COMMANDS } from "./bot";
import {
  clearDefaultRichMenu,
  createRichMenu,
  deleteRichMenu,
  downloadRichMenuImage,
  getDefaultRichMenuId,
  getRichMenu,
  linkUserRichMenu,
  setDefaultRichMenu,
  unlinkUserRichMenu,
  uploadRichMenuImage,
  type RichMenuBody,
} from "./line";
import { deleteMenuImage, getMenuImage, listMenuImages, MENU_IMAGE_NAME, putMenuImage } from "./ll3-file";
import {
  cells,
  CHAT_BAR_MAX,
  HISTORY_KEEP,
  isLayout,
  LAYOUT_KEYS,
  LAYOUTS,
  MAX_MENU_IMAGE,
  NAME_MAX,
  TEXT_MAX,
  type MenuArea,
  type MenuPageData,
  type MenuView,
} from "./richmenu-layout";

/*
 * 後台「圖文選單」：管理者上傳圖片、設定每格按下去做什麼，先傳到自己的 LINE 試看，再換上給所有客人。
 * 用 Messaging API 設定的預設選單會蓋過 LINE 官方帳號後台設定的選單；停用後客人會自動改回看到後台那個。
 */

/* ---------------- 圖片 ---------------- */

export type ImageInfo = { type: "image/png" | "image/jpeg"; ext: "png" | "jpg"; width: number; height: number };

/** 從檔案開頭讀出格式與尺寸；不是 PNG／JPEG 回 null */
export function imageInfo(b: Uint8Array): ImageInfo | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { type: "image/png", ext: "png", width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      }
      // SOF0～SOF15（C4、C8、CC 不是）：高、寬
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { type: "image/jpeg", ext: "jpg", height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}

const SIZES_TEXT = "2500 × 1686（大型）或 2500 × 843（小型）";

/** 上傳一張選單圖片到 ll3（POST /api/admin/richmenu/image） */
export async function uploadMenuImage(bytes: Uint8Array) {
  if (!bytes.length) throw new HttpError(400, "沒有收到圖片");
  if (bytes.length > MAX_MENU_IMAGE) throw new HttpError(413, `圖片 ${Math.ceil(bytes.length / 1024)} KB，LINE 規定要 1MB 以下`);
  const info = imageInfo(bytes);
  if (!info) throw new HttpError(400, "只收 PNG 或 JPG 圖片");
  if (!LAYOUT_KEYS.some((k) => LAYOUTS[k].width === info.width && LAYOUTS[k].height === info.height))
    throw new HttpError(400, `圖片是 ${info.width} × ${info.height}，要 ${SIZES_TEXT}`);
  return { name: await putMenuImage(bytes, info.ext), width: info.width, height: info.height };
}

/* ---------------- 表單 ---------------- */

export type MenuInput = Pick<RichMenuDoc, "name" | "layout" | "width" | "height" | "image" | "areas" | "chatBarText" | "selected">;

const URI = /^(https?:\/\/[^\s]+|tel:[0-9+\-]+)$/;

/** 檢查後台送來的表單 */
export function parseInput(body: Record<string, unknown>): MenuInput {
  const layout = body.layout;
  if (!isLayout(layout)) throw new HttpError(400, "請選版型");
  const L = LAYOUTS[layout];
  const image = String(body.image ?? "");
  if (!MENU_IMAGE_NAME.test(image)) throw new HttpError(400, "請上傳圖片");
  const raw = Array.isArray(body.areas) ? (body.areas as Record<string, unknown>[]) : [];
  const pos = cells(layout);
  if (raw.length !== pos.length) throw new HttpError(400, `${L.label}要設定 ${pos.length} 格`);
  const areas: MenuArea[] = pos.map((p, i) => {
    const letter = String.fromCharCode(65 + i);
    const type = raw[i]?.type === "uri" ? "uri" : "message";
    const value = String(raw[i]?.value ?? "").trim();
    if (!value) throw new HttpError(400, `${letter} 格還沒填內容`);
    if (type === "message" && [...value].length > TEXT_MAX) throw new HttpError(400, `${letter} 格的文字太長（最多 ${TEXT_MAX} 字）`);
    if (type === "uri" && (!URI.test(value) || value.length > 1000)) throw new HttpError(400, `${letter} 格的網址要以 https:// 開頭`);
    return { ...p, type, value };
  });
  const chatBarText = String(body.chatBarText ?? "").trim();
  if (!chatBarText) throw new HttpError(400, "請填選單列文字");
  if ([...chatBarText].length > CHAT_BAR_MAX) throw new HttpError(400, `選單列文字最多 ${CHAT_BAR_MAX} 個字`);
  const name = String(body.name ?? "").trim().slice(0, NAME_MAX) || L.label;
  return { name, layout, width: L.width, height: L.height, image, areas, chatBarText, selected: body.selected !== false };
}

/* ---------------- LINE ---------------- */

function lineBody(d: MenuInput): RichMenuBody {
  return {
    size: { width: d.width, height: d.height },
    selected: d.selected,
    name: d.name.slice(0, 300),
    chatBarText: d.chatBarText,
    areas: d.areas.map((a) => ({
      bounds: { x: a.x, y: a.y, width: a.w, height: a.h },
      action: a.type === "uri" ? { type: "uri", label: "開啟網頁", uri: a.value } : { type: "message", label: [...a.value].slice(0, 20).join(""), text: a.value },
    })),
  };
}

/** 在 LINE 建立選單並傳圖片，回傳 richMenuId（失敗時把建了一半的刪掉） */
async function createOnLine(d: MenuInput) {
  const bytes = await getMenuImage(d.image);
  if (!bytes) throw new HttpError(400, "ll3 上找不到這張圖片，請重新上傳");
  const info = imageInfo(bytes);
  if (!info || info.width !== d.width || info.height !== d.height)
    throw new HttpError(400, `圖片尺寸跟版型不合（版型要 ${d.width} × ${d.height}）`);
  const id = await createRichMenu(lineBody(d));
  try {
    await uploadRichMenuImage(id, bytes, info.type);
  } catch (e) {
    await deleteRichMenu(id).catch(() => {});
    throw e;
  }
  return id;
}

const who = (u: PublicUser) => u.name || u.email;
const newId = () => randomBytes(12).toString("hex");
const warn = (what: string) => (e: unknown) => console.error(`richmenu ${what}`, e);

/** 所有試看中的選單：取消個人選單、刪掉 LINE 上的選單 */
async function clearTests() {
  for (const t of await RichMenu.find({ status: "test" }).lean()) {
    if (t.testUser) await unlinkUserRichMenu(t.testUser).catch(warn("unlink"));
    if (t.lineId) await deleteRichMenu(t.lineId).catch(warn("delete test"));
    await RichMenu.deleteOne({ _id: t._id });
  }
}

/** 目前使用中的改成「換過的」，LINE 上的選單刪掉（換回時用 ll3 的圖片重建） */
async function retireActive(exceptLineId?: string) {
  for (const a of await RichMenu.find({ status: "active" }).lean()) {
    if (a.lineId && a.lineId !== exceptLineId) await deleteRichMenu(a.lineId).catch(warn("delete old"));
    await RichMenu.updateOne({ _id: a._id }, { $set: { status: "history", lineId: null } });
  }
}

/** 換過的只留最近 10 個；ll3 上沒有任何選單用到的圖片刪掉（剛上傳 graceMs 內的先留著，可能正在編輯） */
async function prune(graceMs = 3600_000) {
  const old = await RichMenu.find({ status: "history" }).sort({ appliedAt: -1 }).skip(HISTORY_KEEP).select("_id").lean();
  if (old.length) await RichMenu.deleteMany({ _id: { $in: old.map((o) => o._id) } });
  const used = new Set((await RichMenu.find({}, { image: 1 }).lean()).map((d) => d.image));
  const files = await listMenuImages();
  for (const f of files) if (!used.has(f.name) && Date.now() - f.at > graceMs) await deleteMenuImage(f.name).catch(warn("delete image"));
}

/* ---------------- 動作 ---------------- */

/** 傳到自己的 LINE 試看（只有這個人看得到，蓋過預設選單） */
export async function testMenu(input: MenuInput, user: PublicUser) {
  await connectDB();
  const me = await AdminUser.findById(user.id).lean();
  if (!me?.lineUserId) throw new HttpError(400, "請先綁定你的 LINE");
  await clearTests();
  const lineId = await createOnLine(input);
  try {
    await linkUserRichMenu(me.lineUserId, lineId);
  } catch (e) {
    await deleteRichMenu(lineId).catch(() => {});
    throw e;
  }
  await RichMenu.create({ _id: newId(), ...input, status: "test", lineId, testUser: me.lineUserId, createdBy: who(user) });
}

export async function endTest() {
  await connectDB();
  await clearTests();
}

/** 換上給所有客人：新的表單，或換回以前的（fromId） */
export async function applyMenu(user: PublicUser, input: MenuInput | null, fromId?: string) {
  await connectDB();
  let base: MenuInput & { _id?: string };
  if (fromId) {
    const h = await RichMenu.findOne({ _id: fromId, status: "history" }).lean();
    if (!h) throw new HttpError(404, "找不到這個選單，可能已經被刪掉");
    base = h;
  } else if (input) base = input;
  else throw new HttpError(400, "缺少選單內容");

  const lineId = await createOnLine(base);
  try {
    await setDefaultRichMenu(lineId);
  } catch (e) {
    await deleteRichMenu(lineId).catch(() => {});
    throw e;
  }
  await retireActive(lineId);
  const set = { status: "active" as const, lineId, testUser: null, appliedAt: new Date(), appliedBy: who(user) };
  if (fromId) await RichMenu.updateOne({ _id: fromId }, { $set: set });
  else {
    const d = base as MenuInput;
    await RichMenu.create({ _id: newId(), ...d, ...set, createdBy: who(user) });
  }
  // 試看的人也改回看到所有客人的選單
  await clearTests();
  await prune().catch(warn("prune"));
}

/** 停用：客人改看 LINE 官方帳號後台設定的選單 */
export async function disableMenu() {
  await connectDB();
  await clearDefaultRichMenu();
  await retireActive();
  await prune().catch(warn("prune"));
}

/** 刪除一個換過的選單（使用中、試看中的不能刪）；沒有其他選單用到的圖片會從 ll3 刪掉 */
export async function deleteHistory(id: string) {
  await connectDB();
  const r = await RichMenu.deleteOne({ _id: id, status: "history" });
  if (!r.deletedCount) throw new HttpError(404, "找不到這個選單，可能已經被刪掉");
  await prune().catch(warn("prune"));
}

/* ---------------- 綁定 LINE ---------------- */

const BIND_MINUTES = 10;

export async function startBind(user: PublicUser) {
  await connectDB();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await AdminUser.updateOne({ _id: user.id }, { $set: { lineBind: { code, exp: new Date(Date.now() + BIND_MINUTES * 60_000) } } });
}

export async function unbind(user: PublicUser) {
  await connectDB();
  const me = await AdminUser.findById(user.id).lean();
  const tests = await RichMenu.find({ status: "test", testUser: me?.lineUserId ?? "-" }).lean();
  if (tests.length) await clearTests();
  await AdminUser.updateOne({ _id: user.id }, { $set: { lineUserId: null, lineName: "", lineBind: null } });
}

/* ---------------- 頁面資料 ---------------- */

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

function view(d: RichMenuDoc): MenuView {
  return {
    id: d._id,
    name: d.name,
    layout: d.layout,
    width: d.width,
    height: d.height,
    image: d.image,
    areas: d.areas,
    chatBarText: d.chatBarText,
    selected: d.selected,
    status: d.status,
    appliedAt: iso(d.appliedAt),
    appliedBy: d.appliedBy,
    createdAt: iso(d.createdAt) ?? "",
  };
}

/** 格子位置對得上哪個版型 */
function detectLayout(width: number, height: number, areas: { x: number; y: number; w: number; h: number }[]) {
  const near = (a: number, b: number) => Math.abs(a - b) <= 3;
  return (
    LAYOUT_KEYS.find((k) => {
      const L = LAYOUTS[k];
      if (L.width !== width || L.height !== height) return false;
      const c = cells(k);
      return c.length === areas.length && c.every((p, i) => near(p.x, areas[i].x) && near(p.y, areas[i].y) && near(p.w, areas[i].w) && near(p.h, areas[i].h));
    }) ?? "custom"
  );
}

/** LINE 上的預設選單不是從這裡換的（例如用程式直接設定）：把它的設定和圖片存進來 */
async function importFromLine(lineId: string) {
  const m = await getRichMenu(lineId);
  const img = await downloadRichMenuImage(lineId);
  const info = imageInfo(img.bytes);
  if (!info) throw new Error("LINE 上的選單圖片不是 PNG／JPG");
  const image = await putMenuImage(img.bytes, info.ext);
  const areas = m.areas
    .map((a) => {
      const act = a.action as Record<string, unknown>;
      const type: "uri" | "message" = act.type === "uri" ? "uri" : "message";
      const value = String(act.type === "uri" ? act.uri : (act.text ?? act.displayText ?? act.data ?? ""));
      return { x: a.bounds.x, y: a.bounds.y, w: a.bounds.width, h: a.bounds.height, type, value };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  await retireActive(lineId);
  await RichMenu.create({
    _id: newId(),
    name: m.name.slice(0, NAME_MAX) || "從 LINE 匯入",
    layout: detectLayout(m.size.width, m.size.height, areas),
    width: m.size.width,
    height: m.size.height,
    image,
    areas,
    chatBarText: m.chatBarText,
    selected: m.selected,
    status: "active",
    lineId,
    appliedAt: new Date(),
    appliedBy: "（不是從後台換的）",
    createdBy: "",
  });
}

export async function menuPage(user: PublicUser): Promise<MenuPageData> {
  await connectDB();
  let lineError = "";
  try {
    const defaultId = await getDefaultRichMenuId();
    const active = await RichMenu.findOne({ status: "active" }).lean();
    if (defaultId && active?.lineId !== defaultId) await importFromLine(defaultId);
    // LINE 上已經沒有程式設定的預設選單（被別處停用）→ 這裡也改成換過的
    if (!defaultId && active) await retireActive();
  } catch (e) {
    console.error("richmenu sync", e);
    lineError = `讀不到 LINE 目前的選單：${e instanceof Error ? e.message : e}`;
  }
  const [active, history, test, me, qas] = await Promise.all([
    RichMenu.findOne({ status: "active" }).lean(),
    RichMenu.find({ status: "history" }).sort({ appliedAt: -1 }).limit(HISTORY_KEEP).lean(),
    RichMenu.findOne({ status: "test" }).lean(),
    AdminUser.findById(user.id).lean(),
    QaItem.find({ active: true }, { q: 1 }).sort({ q: 1 }).lean<{ q: string }[]>(),
  ]);
  const bindLive = me?.lineBind && new Date(me.lineBind.exp).getTime() > Date.now() ? me.lineBind : null;
  return {
    active: active ? view(active) : null,
    history: history.map(view),
    test: test ? view(test) : null,
    lineError,
    me: { lineName: me?.lineName ?? "", bound: !!me?.lineUserId, bindCode: bindLive?.code ?? null, bindExp: iso(bindLive?.exp) },
    commands: MENU_COMMANDS.map((c) => ({ text: c.text, desc: c.desc })),
    qas: qas.map((q) => q.q),
  };
}
