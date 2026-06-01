import { NextRequest, NextResponse } from "next/server";
import { tagStore, TagRecord } from "@/lib/tag-store";

export async function POST(req: NextRequest) {
  const { txHash, walletAddress, tag, category, note } = await req.json();

  // A record is meaningful if it carries at least one of: a tag, a category
  // override, or a note. This lets the user save a note/override without a tag.
  if (!txHash || !walletAddress) {
    return NextResponse.json({ error: "txHash and walletAddress are required" }, { status: 400 });
  }
  if (!tag && !category && !note) {
    return NextResponse.json({ error: "Provide at least one of tag, category, or note" }, { status: 400 });
  }

  const key = `${walletAddress.toLowerCase()}:${txHash}`;
  const existing = tagStore.get(key);
  const now = Date.now();
  const record: TagRecord = {
    id: key,
    txHash,
    walletAddress: walletAddress.toLowerCase(),
    // Merge with any existing record so a notes-only save doesn't wipe the tag.
    userTag: tag !== undefined ? String(tag).slice(0, 50) : existing?.userTag ?? "",
    category: category ?? existing?.category ?? "unknown",
    note: note !== undefined ? String(note).slice(0, 500) : existing?.note ?? "",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  tagStore.set(key, record);

  return NextResponse.json({ success: true, tag: record });
}
