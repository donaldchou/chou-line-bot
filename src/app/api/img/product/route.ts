import { checkImgSig } from "@/lib/sign";
import { isSys, productPictureUrl } from "@/lib/ll3";

/** 商品照片：網站後台 product.PICTURE 的圖（http）轉成 https 給 LINE */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const sys = q.get("sys");
  const p = q.get("p") ?? "";
  const url = isSys(sys) ? productPictureUrl(sys, p) : null;
  if (!isSys(sys) || !url || !checkImgSig(q.get("s"), "product", sys, p)) return new Response("not found", { status: 404 });
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const type = res?.headers.get("content-type") ?? "";
  if (!res?.ok || !type.startsWith("image/")) return new Response("not found", { status: 404 });
  return new Response(await res.arrayBuffer(), { headers: { "content-type": type, "cache-control": "public, max-age=3600" } });
}
