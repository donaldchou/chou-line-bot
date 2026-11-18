import { navCounts } from "@/lib/admin-data";
import { handleError, pagesFor, requireUser } from "@/lib/auth";

/** GET 左側選單的數字（只回傳這個帳號看得到的頁面） */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const pages = await pagesFor(user);
    const c = await navCounts();
    return Response.json({
      overview: pages.includes("overview") ? c.human : 0,
      orders: pages.includes("orders") ? c.ordersToday : 0,
    });
  } catch (err) {
    return handleError(err);
  }
}
