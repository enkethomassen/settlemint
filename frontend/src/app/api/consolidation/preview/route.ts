import { NextRequest, NextResponse } from "next/server";
import { buildConsolidationPreview } from "@/lib/consolidation";

// POST /api/consolidation/preview  { address }
// Returns the wallet's token holdings and their estimated MUSD output.
export async function POST(req: NextRequest) {
  const { address } = await req.json().catch(() => ({}));
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Valid EVM address required" }, { status: 400 });
  }

  try {
    const preview = await buildConsolidationPreview(address);
    return NextResponse.json(preview);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[consolidation/preview] failed", { address, message });
    const isTimeout = /timeout|aborted|AbortError/i.test(message);
    return NextResponse.json(
      {
        error: isTimeout ? "Mezo explorer timed out" : "Could not load token balances",
        code: isTimeout ? "EXPLORER_TIMEOUT" : "EXPLORER_UNAVAILABLE",
        detail: message,
      },
      { status: 503 },
    );
  }
}
