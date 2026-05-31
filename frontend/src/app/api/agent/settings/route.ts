import { NextRequest, NextResponse } from "next/server";
import { getSettings, formatSettings, agentStore } from "@/lib/agent-store";

export async function POST(req: NextRequest) {
  const { address, mode, spendingCap } = await req.json();

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const settings = getSettings(address);

  if (mode === "safe" || mode === "autopilot") settings.mode = mode;
  if (spendingCap !== undefined && !isNaN(Number(spendingCap))) {
    settings.spendingCap = Number(spendingCap);
  }

  agentStore.set(address, settings);
  return NextResponse.json({ success: true, ...formatSettings(settings) });
}
