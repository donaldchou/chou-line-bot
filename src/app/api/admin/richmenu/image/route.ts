import { assertCode, handleError, HttpError, requireAdmin } from "@/lib/auth";
import { FileError, getMenuImage, MENU_IMAGE_NAME } from "@/lib/ll3-file";
import { uploadMenuImage } from "@/lib/richmenu";
import { MAX_MENU_IMAGE } from "@/lib/richmenu-layout";

export const maxDuration = 60;

/** POST（body＝PNG／JPG 原始資料）上傳圖文選單圖片到 ll3，回傳 { name, width, height }。需要驗證碼。 */
export async function POST(req: Request) {
  try {
    const user = await requireAdmin(req);
    await assertCode(req, user, "上傳圖片");
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > MAX_MENU_IMAGE) throw new HttpError(413, "圖片要 1MB 以下");
    return Response.json(await uploadMenuImage(bytes));
  } catch (err) {
    if (err instanceof FileError) return Response.json({ error: err.message }, { status: 502 });
    return handleError(err);
  }
}

/** GET ?n=檔名 → 圖片（後台顯示用；檔名是亂數、內容不會變，可以快取） */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const n = new URL(req.url).searchParams.get("n") ?? "";
    if (!MENU_IMAGE_NAME.test(n)) return new Response("not found", { status: 404 });
    const bytes = await getMenuImage(n).catch(() => null);
    if (!bytes) return new Response("not found", { status: 404 });
    return new Response(bytes as BodyInit, {
      headers: { "content-type": n.endsWith(".png") ? "image/png" : "image/jpeg", "cache-control": "private, max-age=31536000, immutable" },
    });
  } catch (err) {
    return handleError(err);
  }
}
