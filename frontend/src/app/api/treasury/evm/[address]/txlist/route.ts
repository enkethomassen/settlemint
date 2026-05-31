import { NextRequest, NextResponse } from "next/server";

const BLOCKSCOUT_BASE = process.env.BLOCKSCOUT_BASE ?? "https://api.explorer.mezo.org";

export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid EVM address" }, { status: 400 });
  }
  try {
    // No filter/limit params — Blockscout v2 doesn't accept them and returns errors.
    // Default page returns 50 transactions (both in and out).
    const url = `${BLOCKSCOUT_BASE}/api/v2/addresses/${address}/transactions`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return NextResponse.json({ status: "1", result: [] });
    }
    const data = await response.json() as any;
    const items: any[] = data?.items ?? [];

    const normalized = items.map((tx: any) => ({
      hash: tx.hash ?? "",
      timeStamp: tx.timestamp
        ? String(Math.floor(new Date(tx.timestamp).getTime() / 1000))
        : "0",
      from: tx.from?.hash ?? tx.from ?? "",
      to: tx.to?.hash ?? tx.to ?? "",
      value: tx.value ?? "0",
      isError: tx.status === "error" ? "1" : "0",
      txreceipt_status: tx.status === "ok" ? "1" : "0",
      gas: String(tx.gas_limit ?? 21000),
      gasUsed: String(tx.gas_used ?? 21000),
      gasPrice: String(tx.gas_price ?? 0),
    }));

    return NextResponse.json({ status: "1", result: normalized });
  } catch {
    return NextResponse.json({ status: "1", result: [] });
  }
}
