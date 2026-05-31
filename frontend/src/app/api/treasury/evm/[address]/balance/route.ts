import { NextRequest, NextResponse } from "next/server";

const BLOCKSCOUT_BASE = process.env.BLOCKSCOUT_BASE ?? "https://eth.blockscout.com";

export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid EVM address" }, { status: 400 });
  }
  try {
    const response = await fetch(`${BLOCKSCOUT_BASE}/api/v2/addresses/${address}`, {
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 30 },
    });
    if (!response.ok) {
      return NextResponse.json({ status: "1", result: "0" });
    }
    const data = await response.json() as any;
    return NextResponse.json({ status: "1", result: data?.coin_balance ?? "0" });
  } catch {
    return NextResponse.json({ status: "1", result: "0" });
  }
}
