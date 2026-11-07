import { saveVipRule } from "@/lib/admin-data";
import { assertCode, handleError, HttpError, readJson, requireAdmin } from "@/lib/auth";

/** PUT { orders, amount } 儲存 VIP 條件（0＝不用這個條件），需要後台驗證碼 */
export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin(req);
    await assertCode(req, admin, "修改");
    const body = await readJson(req);
    const orders = Number(body.orders);
    const amount = Number(body.amount);
    if (!Number.isInteger(orders) || orders < 0 || orders > 1000) throw new HttpError(400, "訂單筆數要是 0～1000 的整數");
    if (!Number.isInteger(amount) || amount < 0 || amount > 10_000_000) throw new HttpError(400, "金額要是 0～10,000,000 的整數");
    if (!orders && !amount) throw new HttpError(400, "兩個條件不能都是 0");
    return Response.json(await saveVipRule({ orders, amount }));
  } catch (err) {
    return handleError(err);
  }
}
