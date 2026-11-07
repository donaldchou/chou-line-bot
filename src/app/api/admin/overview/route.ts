import { overview } from "@/lib/admin-data";
import { handleError, requirePage } from "@/lib/auth";

export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    await requirePage(req, "overview");
    return Response.json(await overview());
  } catch (err) {
    return handleError(err);
  }
}
