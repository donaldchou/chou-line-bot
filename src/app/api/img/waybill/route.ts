import { checkImgSig } from "@/lib/sign";
import { getWaybillJpg, isSys } from "@/lib/ll3";

/** 託運單照片：LINE 讀圖用（https），從 ll3 line_api.asp?a=jpg 轉過來 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const sys = q.get("sys");
  const obt = q.get("obt") ?? "";
  if (!isSys(sys) || !/^\d{1,12}$/.test(obt) || !checkImgSig(q.get("s"), "waybill", sys, obt)) {
    return new Response("not found", { status: 404 });
  }
  const buf = await getWaybillJpg(sys, obt);
  if (!buf) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
}
