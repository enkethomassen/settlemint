import { walletConfig } from "../config";
import type { NormalizedTx } from "../types";

// USD enrichment via CoinGecko free tier. Prices at current spot (fast, free).
// For historical pricing, swap to /coins/{id}/history?date=dd-mm-yyyy.

const SYMBOL_TO_ID: Record<string, string> = {
  ETH: "ethereum",
  WETH: "weth",
  BTC: "bitcoin",
  WBTC: "wrapped-bitcoin",
  USDC: "usd-coin",
  USDT: "tether",
  DAI: "dai",
  MATIC: "matic-network",
  POL: "matic-network",
  ARB: "arbitrum",
  OP: "optimism",
  BASE: "ethereum",
  MUSD: "usd-coin", // treat mUSD as ~$1
};

const STABLECOINS = new Set(["USDC", "USDT", "DAI", "MUSD"]);

// 60-second cache so the free rate limit (30 req/min) is not exhausted.
let priceCache: { at: number; prices: Record<string, number> } = { at: 0, prices: {} };

async function getSpotPrices(symbols: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(symbols.map((s) => SYMBOL_TO_ID[s]).filter(Boolean))];
  if (ids.length === 0) return {};

  if (Date.now() - priceCache.at < 60_000 && ids.every((id) => id in priceCache.prices)) {
    return priceCache.prices;
  }

  const headers: Record<string, string> = {};
  if (walletConfig.coingeckoKey) headers["x-cg-demo-api-key"] = walletConfig.coingeckoKey;

  try {
    const url = `${walletConfig.coingeckoBase}/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
    const res = await fetch(url, { headers });
    if (!res.ok) return priceCache.prices;

    const json = (await res.json()) as Record<string, { usd: number }>;
    const prices: Record<string, number> = { ...priceCache.prices };
    for (const [id, v] of Object.entries(json)) prices[id] = v.usd;
    priceCache = { at: Date.now(), prices };
    return prices;
  } catch {
    return priceCache.prices;
  }
}

export async function enrichWithUsd(txs: NormalizedTx[]): Promise<NormalizedTx[]> {
  const symbols = [...new Set(txs.map((t) => t.asset))];
  const prices = await getSpotPrices(symbols);

  for (const t of txs) {
    if (STABLECOINS.has(t.asset)) {
      t.valueUsd = t.amount; // ~$1 peg
    } else {
      const id = SYMBOL_TO_ID[t.asset];
      const px = id ? prices[id] : undefined;
      if (px != null) t.valueUsd = t.amount * px;
    }
  }

  return txs;
}
