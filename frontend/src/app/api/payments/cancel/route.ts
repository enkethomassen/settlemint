import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/demo-store";

export async function POST(req: NextRequest) {
  const { address, paymentId } = await req.json();

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid or missing address" }, { status: 400 });
  }
  if (paymentId === undefined || isNaN(Number(paymentId))) {
    return NextResponse.json({ error: "Invalid paymentId" }, { status: 400 });
  }

  const user = getUser(address);
  const payment = user.payments.find((p) => p.id === Number(paymentId));
  if (!payment || !payment.isActive) {
    return NextResponse.json({ error: "Payment not found or already cancelled" }, { status: 404 });
  }

  payment.isActive = false;
  return NextResponse.json({ success: true });
}
