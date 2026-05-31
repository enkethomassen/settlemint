import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    mode: "demo",
    walletIntelligence: {
      aiProvider: process.env.OPENAI_API_KEY ? "openai" : "heuristic",
      evmSource: "blockscout-public",
      btcSource: "mempool.space",
    },
    timestamp: new Date().toISOString(),
  });
}
