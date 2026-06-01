import { NextRequest, NextResponse } from "next/server";
import { buildConsolidationPreview } from "@/lib/consolidation";
import { getSettings } from "@/lib/agent-store";
import {
  addRequest,
  consolidationStore,
  getRequests,
  type ConsolidationItem,
  type ConsolidationRequest,
} from "@/lib/consolidation-store";

function monthEndMs(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
}

// POST /api/consolidation/execute  { address, contracts: string[], schedule }
// Queues a consolidation request. In Safe mode it lands as "pending_approval"
// (the user reviews/signs each swap); in Autopilot it is "queued" for execution.
// Balances/prices are recomputed server-side — the client's numbers are never trusted.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { address, contracts, schedule } = body as {
    address?: string;
    contracts?: string[];
    schedule?: "now" | "month_end";
  };

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Valid EVM address required" }, { status: 400 });
  }
  if (!Array.isArray(contracts) || contracts.length === 0) {
    return NextResponse.json({ error: "Select at least one token to consolidate" }, { status: 400 });
  }
  const sched: "now" | "month_end" = schedule === "month_end" ? "month_end" : "now";

  let preview;
  try {
    preview = await buildConsolidationPreview(address);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[consolidation/execute] preview failed", { address, message });
    return NextResponse.json(
      { error: "Could not verify token balances", code: "EXPLORER_UNAVAILABLE", detail: message },
      { status: 503 },
    );
  }

  const wanted = new Set(contracts.map((c) => c.toLowerCase()));
  const items: ConsolidationItem[] = preview.tokens
    .filter((t) => wanted.has(t.contract) && t.priceAvailable && t.estimatedMUSD > 0)
    .map((t) => ({
      contract: t.contract,
      symbol: t.symbol,
      balance: t.balance,
      estimatedMUSD: t.estimatedMUSD,
    }));

  if (items.length === 0) {
    return NextResponse.json(
      { error: "None of the selected tokens have a price to consolidate", code: "NO_PRICEABLE_TOKENS" },
      { status: 400 },
    );
  }

  const mode = getSettings(address).mode;
  const request: ConsolidationRequest = {
    id: consolidationStore.nextId++,
    address: address.toLowerCase(),
    mode,
    schedule: sched,
    scheduledFor: sched === "month_end" ? monthEndMs() : Date.now(),
    status: mode === "safe" ? "pending_approval" : "queued",
    items,
    totalMUSD: items.reduce((s, i) => s + i.estimatedMUSD, 0),
    createdAt: Date.now(),
  };
  addRequest(request);

  return NextResponse.json({
    success: true,
    request,
    message:
      mode === "safe"
        ? "Consolidation request created — review and approve each swap in your queue."
        : "Consolidation queued — the agent will execute the swaps automatically.",
  });
}

// GET /api/consolidation/execute?address=  — list this wallet's requests (report/history).
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Valid EVM address required" }, { status: 400 });
  }
  return NextResponse.json({ requests: getRequests(address) });
}
