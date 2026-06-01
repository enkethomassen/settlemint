// Server-side helper for end-of-month consolidation.
// Builds a token → MUSD preview from REAL on-chain balances (Mezo explorer)
// and REAL prices (explorer exchange_rate + live BTC). Tokens without a known
// price are surfaced as priceAvailable:false rather than given a fabricated value.
//
// MUSD is the unit of account and is pegged 1:1 to USD, so estimated MUSD == USD
// value of the holding.

const BLOCKSCOUT_BASE = process.env.BLOCKSCOUT_BASE ?? "https://api.explorer.mezo.org";
// MUSD token(s) we must NOT try to consolidate into itself.
const MUSD_TOKEN_ADDRESS = (
  process.env.MUSD_CONTRACT_ADDRESS || "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186"
).toLowerCase();
// Mezo native gas token is represented at this ERC-20 address in token-balances.
const NATIVE_BTC_ADDRESS = "0x7b7c000000000000000000000000000000000000";

export interface PreviewToken {
  contract: string;
  symbol: string;
  name: string;
  decimals: number;
  balanceRaw: string;
  balance: number;
  priceUSD: number | null;
  estimatedMUSD: number;
  priceAvailable: boolean;
  iconUrl: string | null;
  isNative: boolean;
}

export interface ConsolidationPreview {
  address: string;
  musdPeg: number;
  tokens: PreviewToken[];
  totalEstimatedMUSD: number;
}

async function fetchBtcPriceUSD(): Promise<number> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      { signal: AbortSignal.timeout(4000) },
    );
    if (res.ok) {
      const data = (await res.json()) as { bitcoin?: { usd?: number } };
      if (data?.bitcoin?.usd) return data.bitcoin.usd;
    }
  } catch {
    /* fall through to default */
  }
  return 73743;
}

export async function buildConsolidationPreview(address: string): Promise<ConsolidationPreview> {
  const [balRes, btcPrice] = await Promise.all([
    fetch(`${BLOCKSCOUT_BASE}/api/v2/addresses/${address}/token-balances`, {
      signal: AbortSignal.timeout(8000),
    }),
    fetchBtcPriceUSD(),
  ]);

  if (!balRes.ok) {
    throw new Error(`Mezo explorer returned HTTP ${balRes.status} for token balances`);
  }

  const raw = (await balRes.json()) as Array<{
    value?: string;
    token?: {
      address?: string;
      symbol?: string;
      name?: string;
      decimals?: string;
      exchange_rate?: string | null;
      icon_url?: string | null;
    };
  }>;

  const tokens: PreviewToken[] = [];

  for (const entry of Array.isArray(raw) ? raw : []) {
    const t = entry.token ?? {};
    const contract = (t.address ?? "").toLowerCase();
    if (!contract) continue;
    // Never consolidate MUSD into MUSD.
    if (contract === MUSD_TOKEN_ADDRESS) continue;

    const decimals = Number.parseInt(t.decimals ?? "18", 10) || 18;
    const balanceRaw = entry.value ?? "0";
    const balance = Number(balanceRaw) / 10 ** decimals;
    if (balance <= 0) continue;

    const isNative = contract === NATIVE_BTC_ADDRESS;
    let priceUSD: number | null = null;
    if (isNative) {
      priceUSD = btcPrice;
    } else if (t.exchange_rate != null && t.exchange_rate !== "") {
      const r = Number.parseFloat(t.exchange_rate);
      priceUSD = Number.isFinite(r) ? r : null;
    }

    const estimatedMUSD = priceUSD != null ? balance * priceUSD : 0;

    tokens.push({
      contract,
      symbol: t.symbol ?? "?",
      name: t.name ?? t.symbol ?? "Unknown token",
      decimals,
      balanceRaw,
      balance,
      priceUSD,
      estimatedMUSD,
      priceAvailable: priceUSD != null,
      iconUrl: t.icon_url ?? null,
      isNative,
    });
  }

  // Priced tokens first, then by value.
  tokens.sort((a, b) =>
    a.priceAvailable === b.priceAvailable
      ? b.estimatedMUSD - a.estimatedMUSD
      : a.priceAvailable ? -1 : 1,
  );

  const totalEstimatedMUSD = tokens.reduce((s, t) => s + t.estimatedMUSD, 0);

  return { address, musdPeg: 1.0, tokens, totalEstimatedMUSD };
}
