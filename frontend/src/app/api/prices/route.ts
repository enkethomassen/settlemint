import { NextResponse } from "next/server";

const MEZO_TOKEN = "0x7B7c000000000000000000000000000000000001";

export async function GET() {
  let btc = 73743;
  let mezoToken = 0.0216; // MEZO governance token — fallback from DeFiLlama

  // Fetch BTC price from CoinGecko and MEZO token from DeFiLlama in parallel
  const [btcRes, mezoRes, blockscoutRes] = await Promise.allSettled([
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", {
      signal: AbortSignal.timeout(4000),
    }),
    fetch(`https://coins.llama.fi/prices/current/mezo:${MEZO_TOKEN}`, {
      signal: AbortSignal.timeout(4000),
    }),
    fetch("https://api.explorer.mezo.org/api/v2/stats", {
      signal: AbortSignal.timeout(4000),
    }),
  ]);

  if (btcRes.status === "fulfilled" && btcRes.value.ok) {
    const data = await btcRes.value.json() as any;
    btc = data?.bitcoin?.usd ?? btc;
  }

  // Blockscout native coin price (BTC) as secondary source
  if (blockscoutRes.status === "fulfilled" && blockscoutRes.value.ok) {
    const data = await blockscoutRes.value.json() as any;
    if (data?.coin_price) btc = parseFloat(data.coin_price);
  }

  if (mezoRes.status === "fulfilled" && mezoRes.value.ok) {
    const data = await mezoRes.value.json() as any;
    const key = `mezo:${MEZO_TOKEN}`;
    const price = data?.coins?.[key]?.price;
    if (price && price > 0) mezoToken = price;
  }

  return NextResponse.json({
    btc,
    mezoToken, // MEZO ERC-20 governance token price in USD
    musd: 1.0, // MUSD is pegged to USD
    timestamp: Date.now(),
  });
}
