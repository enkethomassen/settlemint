import { NextRequest, NextResponse } from "next/server";
import { getUser, store } from "@/lib/demo-store";

export async function POST(req: NextRequest) {
  const { address, recipient, amount, interval, isX402, endpoint } = await req.json();

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid or missing address" }, { status: 400 });
  }
  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }
  if (!interval || isNaN(Number(interval)) || Number(interval) < 60) {
    return NextResponse.json({ error: "Interval must be >= 60 seconds" }, { status: 400 });
  }
  if (!isX402 && (!recipient || !/^0x[a-fA-F0-9]{40}$/.test(recipient))) {
    return NextResponse.json({ error: "Valid recipient address required for wallet payments" }, { status: 400 });
  }
  if (isX402 && (!endpoint || !endpoint.startsWith("http"))) {
    return NextResponse.json({ error: "Valid x402 endpoint URL required" }, { status: 400 });
  }

  const user = getUser(address);
  const paymentId = store.nextId++;
  const now = Math.floor(Date.now() / 1000);

  user.payments.push({
    id: paymentId,
    recipient: isX402 ? "0x0000000000000000000000000000000000000000" : recipient,
    amount,
    interval: Number(interval),
    lastExecuted: 0,
    isActive: true,
    isX402: Boolean(isX402),
    endpoint: isX402 ? endpoint : "",
    nextExecution: "NOW",
  });

  return NextResponse.json({
    success: true,
    paymentId,
    message: "Payment scheduled in demo mode",
  });
}
