import { handleError, meOf, requireUser } from "@/lib/auth";

/** GET /api/auth/me 目前登入的帳號與看得到的頁面 */
export async function GET(req: Request) {
  try {
    return Response.json(await meOf(await requireUser(req)));
  } catch (err) {
    return handleError(err);
  }
}
