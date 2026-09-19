import { tokenById } from "@/lib/launchpad/transactions";
import { purchaseShareImage } from "@/lib/purchase-share-image";
import { saleShare } from "@/lib/launchpad/sale-share";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id))
    return new Response("Not found", { status: 404 });
  try {
    const token = await tokenById(id);
    const url = new URL(request.url);
    const side = url.searchParams.get("side") === "sell" ? "sell" : "buy";
    const response = await purchaseShareImage(
      token.ticker,
      url.searchParams.get("card") === "1",
      side,
      side === "sell" && url.searchParams.get("sale")
        ? await saleShare(id, url.searchParams.get("sale")!)
        : undefined,
    );
    if (url.searchParams.has("sale"))
      response.headers.set("Cache-Control", "no-store");
    if (url.searchParams.has("download"))
      response.headers.set(
        "Content-Disposition",
        `attachment; filename="oneonly-${side === "sell" ? "sell-" : ""}${token.ticker.replace(/[^A-Z0-9]/gi, "")}.png"`,
      );
    return response;
  } catch {
    return new Response("Share image unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
