import { NextRequest, NextResponse } from "next/server";
import { tagStore } from "@/lib/tag-store";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }
  const lc = address.toLowerCase();
  const tags = Array.from(tagStore.values()).filter(
    (t) => t.walletAddress === lc
  );
  return NextResponse.json({ tags });
}
