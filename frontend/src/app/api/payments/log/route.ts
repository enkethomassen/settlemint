import { NextResponse } from "next/server";
import { store } from "@/lib/demo-store";

export async function GET() {
  return NextResponse.json({
    log: store.log.map((entry) => ({
      ...entry,
      amount: typeof entry.amount === "bigint" ? "0.0" : entry.amount ?? "0.0",
      date: new Date(entry.timestamp).toISOString(),
    })),
  });
}
