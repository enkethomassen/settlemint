import { NextResponse } from "next/server";
import { store } from "@/lib/demo-store";

export async function GET() {
  return NextResponse.json({
    running: false,
    lastRun: null,
    registeredUsers: store.users.size,
    totalChecked: 0,
    totalExecuted: store.log.length,
  });
}
