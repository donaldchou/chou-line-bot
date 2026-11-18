import { assertCode, handleError, HttpError, requireAdmin } from "@/lib/auth";
import { FileError, PHOTO_NAME, putPhoto } from "@/lib/ll3-file";
import { cleanupPhotos } from "@/lib/qa";
import { connectDB } from "@/lib/mongodb";

export const maxDuration = 60;

/** 瀏覽器先縮成 JPEG 再傳，這裡只是保險 */
const MAX_BYTES = 3_000_000;

/** POST（body＝JPEG 原始資料）上傳一張問答照片到 ll3，回傳 { name }。需要驗證碼。 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    await assertCode(req, admin, "上傳照片");
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) throw new HttpError(400, "沒有收到照片");
    if (bytes.length > MAX_BYTES) throw new HttpError(413, "照片太大");
    // JPEG 開頭一定是 FF D8 FF
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new HttpError(400, "只收 JPEG 照片");
    return Response.json({ name: await putPhoto(bytes) });
  } catch (err) {
    if (err instanceof FileError) return Response.json({ error: err.message }, { status: 502 });
    return handleError(err);
  }
}

/** DELETE ?n=檔名：取消編輯時，把剛上傳、沒有存進問答的照片刪掉（有問答在用就不刪） */
export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin(req);
    await assertCode(req, admin, "刪除照片");
    const names = new URL(req.url).searchParams.getAll("n").filter((n) => PHOTO_NAME.test(n)).slice(0, 40);
    await connectDB();
    await cleanupPhotos(names);
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
