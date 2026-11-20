import { assertCode, handleError, HttpError, readJson, requireAdmin } from "@/lib/auth";
import { FileError } from "@/lib/ll3-file";
import { applyMenu, disableMenu, endTest, menuPage, parseInput, startBind, testMenu, unbind } from "@/lib/richmenu";

/* 後台「圖文選單」（只有管理者） */

export const maxDuration = 60;

const fail = (err: unknown) => (err instanceof FileError ? Response.json({ error: err.message }, { status: 502 }) : handleError(err));

/** GET → 目前使用中、換過的、試看中、我的 LINE 綁定狀態、可選的指令和問答 */
export async function GET(req: Request) {
  try {
    const user = await requireAdmin(req);
    return Response.json(await menuPage(user));
  } catch (err) {
    return fail(err);
  }
}

/**
 * POST { action }
 *   test     （表單）傳到我的 LINE 試看          需要驗證碼
 *   apply    （表單）換上 LINE（所有客人）        需要驗證碼
 *   restore  { id } 換回以前的選單               需要驗證碼
 *   disable  停用，改回 LINE 官方帳號後台的選單   需要驗證碼
 *   endTest  結束試看
 *   bind / unbind  綁定／解除綁定我的 LINE
 */
export async function POST(req: Request) {
  try {
    const user = await requireAdmin(req);
    const body = await readJson(req);
    switch (body.action) {
      case "test":
        await assertCode(req, user, "傳到 LINE 試看");
        await testMenu(parseInput(body), user);
        break;
      case "apply":
        await assertCode(req, user, "換上圖文選單");
        await applyMenu(user, parseInput(body));
        break;
      case "restore":
        await assertCode(req, user, "換回這個選單");
        await applyMenu(user, null, String(body.id ?? ""));
        break;
      case "disable":
        await assertCode(req, user, "停用圖文選單");
        await disableMenu();
        break;
      case "endTest":
        await endTest();
        break;
      case "bind":
        await startBind(user);
        break;
      case "unbind":
        await unbind(user);
        break;
      default:
        throw new HttpError(400, "不認得的動作");
    }
    return Response.json(await menuPage(user));
  } catch (err) {
    return fail(err);
  }
}
