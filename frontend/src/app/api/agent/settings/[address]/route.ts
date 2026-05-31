import { NextRequest, NextResponse } from "next/server";
import { getSettings, formatSettings } from "@/lib/agent-store";

export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  const settings = getSettings(address);
  return NextResponse.json(formatSettings(settings));
}
