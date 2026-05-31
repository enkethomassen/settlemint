import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/demo-store";

export async function POST(req: NextRequest) {
  const { address } = await req.json();
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  getUser(address);
  return NextResponse.json({ success: true, address, message: "Registered for scheduler" });
}
