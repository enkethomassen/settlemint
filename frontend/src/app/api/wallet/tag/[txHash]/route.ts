import { NextRequest, NextResponse } from "next/server";
import { tagStore } from "@/lib/tag-store";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { txHash: string } }
) {
  const { walletAddress } = await req.json().catch(() => ({}));
  if (!walletAddress) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }
  const key = `${walletAddress.toLowerCase()}:${params.txHash}`;
  tagStore.delete(key);
  return NextResponse.json({ success: true });
}
