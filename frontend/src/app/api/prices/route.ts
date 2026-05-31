import { NextResponse } from "next/server";

export async function GET() {
  let btc = 73743;
  let mezo = 0.12; // MUSD/USD — stable

  // Try CoinGecko free API for live BTC price
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const data = await res.json() as any;
      btc = data?.bitcoin?.usd ?? btc;
    }
  } catch {}

  // Also fetch from Mezo Blockscout as secondary source
  try {
    const res = await fetch(
      "https://api.explorer.mezo.org/api/v2/stats",
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const data = await res.json() as any;
      if (data?.coin_price) btc = parseFloat(data.coin_price);
    }
  } catch {}

  return NextResponse.json({
    btc,
    mezo,
    musd: 1.0, // MUSD is pegged to USD
    timestamp: Date.now(),
  });
}
