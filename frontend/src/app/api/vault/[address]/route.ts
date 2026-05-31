import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  // Demo vault — no live contract configured
  return NextResponse.json({
    address,
    collateral: "0.0",
    musdBalance: "0.0",
    collateralRatio: 0,
    payments: [],
  });
}
