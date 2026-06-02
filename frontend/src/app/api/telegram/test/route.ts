import { NextResponse } from "next/server";

export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const hasToken = token.length > 10;

  // Test if the token actually works by calling getMe
  let botInfo: any = null;
  let tokenValid = false;
  if (hasToken) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(5000),
      });
      botInfo = await res.json();
      tokenValid = botInfo?.ok === true;
    } catch {
      botInfo = { error: "fetch failed" };
    }
  }

  return NextResponse.json({
    tokenPresent: hasToken,
    tokenLength: token.length,
    tokenValid,
    botInfo,
  });
}
