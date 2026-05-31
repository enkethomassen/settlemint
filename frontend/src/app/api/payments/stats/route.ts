import { NextResponse } from "next/server";
import { store } from "@/lib/demo-store";

export async function GET() {
  const log = store.log;
  const successful = log.filter((e) => e.success).length;
  const walletPayments = log.filter((e) => e.type === "wallet").length;
  const x402Payments = log.filter((e) => e.type === "x402").length;

  return NextResponse.json({
    total: log.length,
    successful,
    failed: log.length - successful,
    walletPayments,
    x402Payments,
    totalMUSD: 0,
    x402Spending: {},
  });
}
