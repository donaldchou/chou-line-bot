import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connectDB } from "./mongodb";
import { AdminSetting, AdminUser } from "./models";
import { isPageKey, PAGE_KEYS, type Me, type PageAccessSettings, type PageKey, type Role } from "./page-access";
import { SESSION_COOKIE, UNLOCK_COOKIE, verifySession, verifyUnlock } from "./session";
import { safeEqual } from "./sign";

/* 後台登入帳號、權限、驗證碼（照 chou-platform 的 auth / access / codes） */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** API 共用的錯誤處理：HttpError 照狀態碼回，其他記錄後回 500 */
export function handleError(err: unknown) {
  if (err instanceof HttpError) return Response.json({ error: err.message, ...err.extra }, { status: err.status });
  // Next.js 內部的中斷（例如 build 時判斷動態路由）要原樣丟回去，不能當成錯誤吞掉
  if (err && typeof err === "object" && "digest" in err) throw err;
  console.error(err);
  return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/* ---------------- 密碼（scrypt，不用另外裝套件） ---------------- */
const scryptAsync = (pw: string, salt: Buffer) =>
  new Promise<Buffer>((ok, fail) => scrypt(pw, salt, 64, (e, k) => (e ? fail(e) : ok(k))));

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${(await scryptAsync(password, salt)).toString("hex")}`;
}

export async function checkPassword(password: string, hash: string) {
  const [kind, salt, key] = hash.split("$");
  if (kind !== "scrypt" || !salt || !key) return false;
  const got = await scryptAsync(password, Buffer.from(salt, "hex"));
  const want = Buffer.from(key, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export function assertPassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || password.length < 8) throw new HttpError(400, "密碼至少要 8 個字元");
}

export const normEmail = (v: unknown) => String(v ?? "").trim().toLowerCase();
export function assertEmail(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "email 格式不正確");
}

/* ---------------- 使用者 ---------------- */
export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  hiddenPages: PageKey[];
  lastLoginAt: string | null;
  createdAt: string;
};

/** 給前端的使用者資料（拿掉密碼雜湊） */
export function publicUser(doc: Record<string, unknown>): PublicUser {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
  return {
    id: String(doc._id),
    email: String(doc.email),
    name: String(doc.name ?? ""),
    role: doc.role === "admin" ? "admin" : "user",
    active: doc.active !== false,
    hiddenPages: ((doc.hiddenPages as unknown[]) ?? []).filter(isPageKey),
    lastLoginAt: iso(doc.lastLoginAt),
    createdAt: iso(doc.createdAt) ?? "",
  };
}

/** 從本站送出的請求才接受修改（防跨站請求） */
function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(req.url).host) throw new HttpError(403, "來源不正確");
}

/**
 * 從 cookie 取出目前登入的使用者，並回資料庫確認帳號還在、沒被停用。
 * 身分以資料庫為準，所以後台改了身分或停用帳號會立刻生效。
 */
export async function currentUser(): Promise<PublicUser | null> {
  const session = verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  await connectDB();
  const doc = await AdminUser.findById(session.userId).lean();
  if (!doc) return null;
  const user = publicUser(doc as unknown as Record<string, unknown>);
  return user.active ? user : null;
}

/** 必須登入，否則 401 */
export async function requireUser(req: Request) {
  assertSameOrigin(req);
  const user = await currentUser();
  if (!user) throw new HttpError(401, "請先登入");
  return user;
}

/** 必須是管理者，否則 403（一般使用者只能看） */
export async function requireAdmin(req: Request) {
  const user = await requireUser(req);
  if (user.role !== "admin") throw new HttpError(403, "一般使用者只能檢視，不能修改");
  return user;
}

/* ---------------- 頁面權限 ---------------- */
const SETTING_ID = "pageAccess";

/** ① 一般使用者可以看的頁面；還沒設定過＝全部都可以看 */
export async function basePages(): Promise<PageKey[]> {
  await connectDB();
  const doc = (await AdminSetting.findById(SETTING_ID).lean()) as { allowed?: string[] } | null;
  return doc?.allowed ? PAGE_KEYS.filter((k) => doc.allowed!.includes(k)) : [...PAGE_KEYS];
}

/** 這個帳號看得到的頁面：管理者全部；一般使用者 ＝ ① 有勾、② 沒勾 */
export async function pagesFor(user: PublicUser): Promise<PageKey[]> {
  if (user.role === "admin") return [...PAGE_KEYS];
  return (await basePages()).filter((k) => !user.hiddenPages.includes(k));
}

export async function meOf(user: PublicUser): Promise<Me> {
  return { id: user.id, email: user.email, name: user.name, role: user.role, pages: await pagesFor(user) };
}

/** 讀取資料的 API：要有其中一個頁面的權限，否則 403（管理者一律通過） */
export async function requirePage(req: Request, ...keys: PageKey[]) {
  const user = await requireUser(req);
  if (user.role === "admin") return user;
  const pages = await pagesFor(user);
  if (!keys.some((k) => pages.includes(k))) throw new HttpError(403, "你的帳號沒有權限查看這個頁面");
  return user;
}

/** 後台「頁面權限」分頁要的資料 */
export async function getPageAccess(): Promise<PageAccessSettings> {
  await connectDB();
  const users = await AdminUser.find({ role: "user" }).sort({ createdAt: 1 }).lean();
  return {
    allowed: await basePages(),
    users: users.map((u) => ({
      id: String(u._id),
      email: u.email,
      name: u.name ?? "",
      active: u.active,
      hiddenPages: (u.hiddenPages ?? []).filter(isPageKey),
    })),
  };
}

/** 儲存：{ allowed: PageKey[], hidden: { 帳號 id: PageKey[] } }；只接受認得的頁面、只改一般使用者 */
export async function savePageAccess(body: Record<string, unknown>) {
  await connectDB();
  if (!Array.isArray(body.allowed)) throw new HttpError(400, "缺少 allowed");
  const allowed = PAGE_KEYS.filter((k) => (body.allowed as unknown[]).includes(k));
  await AdminSetting.updateOne({ _id: SETTING_ID }, { $set: { allowed } }, { upsert: true });

  const hidden = (body.hidden ?? {}) as Record<string, unknown>;
  if (typeof hidden !== "object" || Array.isArray(hidden)) throw new HttpError(400, "hidden 格式不正確");
  for (const [id, keys] of Object.entries(hidden)) {
    if (!Array.isArray(keys)) throw new HttpError(400, "hidden 格式不正確");
    await AdminUser.updateOne({ _id: id, role: "user" }, { $set: { hiddenPages: PAGE_KEYS.filter((k) => keys.includes(k)) } });
  }
  return getPageAccess();
}

/* ---------------- 後台驗證碼（ADMIN_CODE） ---------------- */
export const CODE_HEADER = "x-verify-code";

function expectedCode() {
  const c = process.env.ADMIN_CODE;
  if (!c) throw new HttpError(500, "伺服器尚未設定 ADMIN_CODE");
  return c;
}

/** 解鎖中（還沒過期）回傳到期時間（毫秒） */
export async function unlockedUntil(userId: string) {
  return verifyUnlock((await cookies()).get(UNLOCK_COOKIE)?.value, userId);
}

/**
 * 後台的新增、修改、刪除都要驗證碼：header x-verify-code（前端 encodeURIComponent），或在解鎖時數內。
 * 錯誤時丟 403。
 */
export async function assertCode(req: Request, user: PublicUser, what: string) {
  if ((await unlockedUntil(user.id)) !== null) return;
  let code = "";
  try {
    code = decodeURIComponent(req.headers.get(CODE_HEADER) ?? "");
  } catch {}
  if (!safeEqual(code, expectedCode())) throw new HttpError(403, `驗證碼錯誤，無法${what}`);
}

export function assertUnlockCode(given: string) {
  if (!safeEqual(given, expectedCode())) throw new HttpError(403, "驗證碼錯誤，無法解鎖");
}
