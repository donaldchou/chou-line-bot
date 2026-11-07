import { assertCode, handleError, requireAdmin } from "@/lib/auth";

/** POST 只檢查驗證碼、不做任何修改（打開新增／重設密碼表單前先確認）；真正修改時後端還會再檢查一次 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    await assertCode(req, admin, "操作");
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
