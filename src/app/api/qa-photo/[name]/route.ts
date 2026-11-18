import { getPhoto, PHOTO_NAME } from "@/lib/ll3-file";

/**
 * 問答照片（存在 ll3，資料夾擋掉直接下載）：轉給 LINE 和後台。
 * 不用登入（LINE 要能讀）；檔名是 24 個字的亂數猜不到，同一個檔名內容不會變，可以長期快取。
 */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!PHOTO_NAME.test(name)) return new Response("not found", { status: 404 });
  const res = await getPhoto(name).catch(() => null);
  if (!res) return new Response("not found", { status: 404 });
  return new Response(await res.arrayBuffer(), {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
  });
}
