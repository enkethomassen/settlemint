import { NextRequest, NextResponse } from "next/server";
import { tagStore, TagRecord } from "@/lib/tag-store";

export async function POST(req: NextRequest) {
  const { txHash, walletAddress, tag, category } = await req.json();

  if (!txHash || !walletAddress || !tag) {
    return NextResponse.json({ error: "txHash, walletAddress, and tag are required" }, { status: 400 });
  }

  const key = `${walletAddress.toLowerCase()}:${txHash}`;
  const record: TagRecord = {
    id: key,
    txHash,
    walletAddress: walletAddress.toLowerCase(),
    userTag: String(tag).slice(0, 50),
    category: category ?? "unknown",
    createdAt: Date.now(),
  };
  tagStore.set(key, record);

  return NextResponse.json({ success: true, tag: record });
}
