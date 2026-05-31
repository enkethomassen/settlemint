import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    message: "Scheduler triggered — no payments pending in demo mode",
  });
}
