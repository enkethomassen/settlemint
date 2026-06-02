import { NextRequest, NextResponse } from "next/server";
import {
  buildMezoActivity,
  type RawNativeTx,
  type RawTokenTransfer,
  type TreasuryLedgerEvent,
} from "@/lib/mezo-ledger";

const MEZO_API = process.env.BLOCKSCOUT_BASE ?? "https://api.explorer.mezo.org";
const COINGECKO_BASE = process.env.COINGECKO_BASE ?? "https://api.coingecko.com/api/v3";
const DEFILLAMA_BASE = "https://coins.llama.fi";
const MEZO_TOKEN_ADDRESS = "0x7B7c000000000000000000000000000000000001";
const NATIVE_DECIMALS = 1e18;
const EXPLORER_TIMEOUT = 10_000;
const PRICE_TIMEOUT = 10_000;
const MAX_PAGES = 20;
const isDev = process.env.NODE_ENV !== "production";

// ── Paginated Blockscout fetch ────────────────────────────────────────────────
// Follows `next_page_params` until: no more pages, MAX_PAGES safety limit, or
// the oldest item on a page is older than the requested cutoff (results are
// returned newest-first). Returns every item across the fetched pages.
async function fetchPaginated(
  path: string,
  cutoffSec: number,
): Promise<{ items: any[]; pages: number }> {
  const items: any[] = [];
  let params: Record<string, string | number> | null = null;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const qs = params
      ? "?" + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
      : "";
    const res = await fetch(`${MEZO_API}${path}${qs}`, {
      signal: AbortSignal.timeout(EXPLORER_TIMEOUT),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      if (pages === 0) throw new Error(`Explorer HTTP ${res.status} for ${path}`);
      break; // partial data is better than none on a later page
    }
    const data = (await res.json()) as { items?: any[]; next_page_params?: Record<string, any> | null };
    const page = Array.isArray(data.items) ? data.items : [];
    items.push(...page);
    pages++;

    // Stop once we've paged past the range boundary.
    const oldest = page[page.length - 1];
    const oldestTs = oldest?.timestamp ? new Date(oldest.timestamp).getTime() / 1000 : null;
    if (oldestTs != null && oldestTs < cutoffSec) break;

    if (!data.next_page_params || page.length === 0) break;
    params = data.next_page_params as Record<string, string | number>;
  }

  return { items, pages };
}

async function fetchAddressInfo(address: string): Promise<any | null> {
  try {
    const res = await fetch(`${MEZO_API}/api/v2/addresses/${address}`, {
      signal: AbortSignal.timeout(EXPLORER_TIMEOUT),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchBtcPrice(fallback: number | null): Promise<number | null> {
  try {
    const res = await fetch(`${COINGECKO_BASE}/simple/price?ids=bitcoin&vs_currencies=usd`, {
      signal: AbortSignal.timeout(PRICE_TIMEOUT),
    });
    if (res.ok) {
      const data = (await res.json()) as { bitcoin?: { usd?: number } };
      if (data?.bitcoin?.usd) return data.bitcoin.usd;
    }
  } catch {
    /* fall through */
  }
  return fallback;
}

async function fetchMezoTokenPrice(): Promise<number | null> {
  try {
    const res = await fetch(
      `${DEFILLAMA_BASE}/prices/current/mezo:${MEZO_TOKEN_ADDRESS}`,
      { signal: AbortSignal.timeout(PRICE_TIMEOUT) },
    );
    if (res.ok) {
      const data = (await res.json()) as { coins?: Record<string, { price?: number }> };
      const price = data?.coins?.[`mezo:${MEZO_TOKEN_ADDRESS}`]?.price;
      if (price && price > 0) return price;
    }
  } catch {
    /* fall through */
  }
  return null;
}

async function fetchBTCData(address: string) {
  const sources = [
    `https://mempool.space/api/address/${address}`,
    `https://blockchain.info/rawaddr/${address}?limit=50&cors=true`,
  ];
  for (const url of sources) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) return await res.json();
    } catch {}
  }
  return null;
}

function detectRecurringBTC(outflows: any[]) {
  const byTo: Record<string, number[]> = {};
  for (const tx of outflows) {
    const key = tx.to.toLowerCase();
    (byTo[key] ??= []).push(tx.timestamp);
  }
  const recurring = [];
  for (const [addr, times] of Object.entries(byTo)) {
    if (times.length < 2) continue;
    times.sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const variance = gaps.reduce((s, g) => s + Math.abs(g - avgGap), 0) / gaps.length;
    const isRegular = variance < avgGap * 0.35;
    const frequency = avgGap < 86400 * 2 ? "daily" : avgGap < 86400 * 10 ? "weekly" : "monthly";
    const txs = outflows.filter(t => t.to.toLowerCase() === addr);
    recurring.push({
      toAddress: addr,
      amount: txs[0].amount,
      amountUSD: txs[0].amountUSD,
      token: txs[0].token,
      frequency,
      confidence: isRegular ? 0.85 : 0.55,
      occurrences: times.length,
      totalSpent: txs.reduce((s, t) => s + t.amountUSD, 0),
      totalToken: txs.reduce((s, t) => s + t.amount, 0),
      usdAvailable: true,
    });
  }
  return recurring.sort((a, b) => b.totalSpent - a.totalSpent);
}

// Map a normalized ledger event → the WalletTransaction shape the UI consumes.
function toWalletTx(e: TreasuryLedgerEvent) {
  return {
    hash: e.txHash,
    timestamp: e.timestamp,
    from: e.from,
    to: e.to,
    amount: e.tokenAmount,
    amountUSD: e.usdValue ?? 0,
    token: e.tokenSymbol,
    category: e.category,
    isFiltered: e.isFiltered,
    filterReason: e.filterReason,
    // ── extended fields (token-denominated display) ──
    direction: e.direction,
    counterparty: e.counterparty,
    kind: e.kind,
    tokenSymbol: e.tokenSymbol,
    tokenAddress: e.tokenAddress,
    usdAvailable: e.usdAvailable,
    usdPriceSource: e.usdPriceSource,
    displayValue: e.displayValue,
    displayUsd: e.displayUsd,
  };
}

function structuredError(code: string, message: string, detail: string, status: number, retryable = true) {
  return NextResponse.json({ error: message, code, message, detail, retryable }, { status });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { address, addressType, range = "90d" } = body;
  const minValueUSD =
    typeof body.minValueUSD === "number" && body.minValueUSD >= 0 ? body.minValueUSD : 1.0;
  const includeUnknownPrice = body.includeUnknownPrice !== false;
  if (!address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  const isBTC =
    addressType === "bitcoin" ||
    /^(1|3)[a-zA-HJ-NP-Z0-9]{25,34}$/.test(address) ||
    /^bc1[a-zA-HJ-NP-Z0-9]{6,87}$/.test(address);

  const rangeDays = range === "30d" ? 30 : range === "180d" ? 180 : range === "1y" ? 365 : range === "all" ? 3650 : 90;
  const cutoffTs = Math.floor(Date.now() / 1000) - rangeDays * 86400;

  // ── BTC ────────────────────────────────────────────────────────────────────
  if (isBTC) {
    const raw = await fetchBTCData(address);
    if (!raw) {
      return structuredError("BTC_EXPLORER_UNAVAILABLE", "Could not reach a Bitcoin explorer.", "All BTC sources failed or timed out.", 502);
    }

    const btcPrice = (await fetchBtcPrice(73743)) ?? 73743;
    const balance = (raw.final_balance ?? 0) / 1e8;
    const txs: any[] = raw.txs ?? [];

    const transactions = txs.map((tx: any) => {
      const isOut = (tx.inputs ?? []).some((i: any) => i.prev_out?.addr === address);
      const valueRaw = isOut
        ? (tx.inputs ?? []).reduce((s: number, i: any) => (i.prev_out?.addr === address ? s + (i.prev_out?.value ?? 0) : s), 0)
        : (tx.out ?? []).reduce((s: number, o: any) => (o.addr === address ? s + (o.value ?? 0) : s), 0);
      const amount = valueRaw / 1e8;
      const amountUSD = amount * btcPrice;
      const ts = tx.time ?? 0;
      const outOfRange = ts < cutoffTs;
      const isDust = !outOfRange && amountUSD < minValueUSD;
      return {
        hash: tx.hash ?? "",
        timestamp: ts,
        from: isOut ? address : "external",
        to: isOut ? "external" : address,
        amount,
        amountUSD,
        token: "BTC",
        category: "transfer",
        direction: isOut ? "outgoing" : "incoming",
        usdAvailable: true,
        displayValue: `${amount.toFixed(6)} BTC`,
        displayUsd: amountUSD ? `$${amountUSD.toFixed(2)}` : null,
        isFiltered: outOfRange || isDust,
        filterReason: outOfRange ? `Outside ${range} range` : isDust ? `Below $${minValueUSD.toFixed(2)} minimum` : undefined,
      };
    });

    const inRange = transactions.filter(t => !t.isFiltered);
    const outflows = inRange.filter(t => t.from === address);
    const totalOutflow = outflows.reduce((s, t) => s + t.amountUSD, 0);
    const monthlyBurn = totalOutflow / (rangeDays / 30);
    const balanceUSD = balance * btcPrice;
    const runway = monthlyBurn > 0 ? `${(balanceUSD / monthlyBurn).toFixed(1)} months` : "∞";
    const reserveScore = balance > 0.1 ? 90 : balance > 0.01 ? 70 : 40;

    return NextResponse.json({
      address,
      addressType: "bitcoin",
      range,
      minValueUSD,
      totalOutflow,
      totalInflow: inRange.filter(t => t.to === address).reduce((s, t) => s + t.amountUSD, 0),
      monthlyBurn,
      monthlyBurnTokens: {},
      runway,
      reserveScore,
      transactions,
      recurringPayments: detectRecurringBTC(outflows),
      spendByCategory: totalOutflow > 0 ? [{ category: "transfer", amountUSD: totalOutflow, percentage: 100 }] : [],
      swapActivity: { count: 0, volumeUSD: 0 },
      aiInsights: [],
      topRecipients: [],
      tokenOutflows: {},
      tokenInflows: {},
      priceWarnings: [],
    });
  }

  // ── EVM / Mezo ─────────────────────────────────────────────────────────────
  let nativeTxs: RawNativeTx[];
  let tokenTransfers: RawTokenTransfer[];
  let nativePages = 0;
  let tokenPages = 0;
  let addrInfo: any = null;

  try {
    const [info, native, tokens] = await Promise.all([
      fetchAddressInfo(address),
      fetchPaginated(`/api/v2/addresses/${address}/transactions`, cutoffTs),
      fetchPaginated(`/api/v2/addresses/${address}/token-transfers`, cutoffTs),
    ]);
    addrInfo = info;
    nativeTxs = native.items as RawNativeTx[];
    nativePages = native.pages;
    tokenTransfers = tokens.items as RawTokenTransfer[];
    tokenPages = tokens.pages;
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    const isTimeout = /timeout|aborted|AbortError/i.test(detail);
    return structuredError(
      isTimeout ? "MEZO_EXPLORER_TIMEOUT" : "MEZO_EXPLORER_UNAVAILABLE",
      "Could not reach Mezo explorer.",
      detail,
      503,
    );
  }

  // BTC price drives the native asset + wrapped-BTC pricing. Prefer live
  // CoinGecko, fall back to the explorer-reported exchange_rate.
  const explorerRate = addrInfo?.exchange_rate ? Number.parseFloat(addrInfo.exchange_rate) : null;
  const [btcPrice, mezoPrice] = await Promise.all([
    fetchBtcPrice(Number.isFinite(explorerRate as number) ? explorerRate : null),
    fetchMezoTokenPrice(),
  ]);

  const activity = buildMezoActivity({
    address,
    range,
    rangeDays,
    nativeTxs,
    tokenTransfers,
    btcPrice,
    mezoPrice,
    minValueUSD,
    includeUnknownPrice,
  });

  if (isDev) {
    console.log("[wallet/analyze] mezo diagnostics", {
      address,
      range,
      nativePages,
      tokenPages,
      nativeTransactionCount: activity.nativeTransactionCount,
      tokenTransferCount: activity.tokenTransferCount,
      ledgerEventCount: activity.ledgerEventCount,
      skippedCount: activity.skippedCount,
      skippedReasons: activity.skippedReasons,
      knownUsdOutgoing: activity.totals.knownUsdOutgoing,
      unknownPriceTokenOutgoing: activity.totals.unknownPriceTokenOutgoing,
    });
  }

  // Balance + health
  const balanceWei = parseFloat(addrInfo?.coin_balance ?? "0");
  const balance = balanceWei / NATIVE_DECIMALS;
  const balanceUSD = btcPrice != null ? balance * btcPrice : 0;
  const runway =
    activity.monthlyBurn > 0 && balanceUSD > 0
      ? `${(balanceUSD / activity.monthlyBurn).toFixed(1)} months`
      : "∞";
  const reserveScore = balanceUSD > 1000 ? 90 : balanceUSD > 100 ? 75 : balanceUSD > 10 ? 55 : 30;

  // Map recurring patterns to the UI's RecurringPayment shape.
  const recurringPayments = activity.recurringPatterns.map(r => ({
    toAddress: r.toAddress,
    toLabel: r.toLabel,
    amount: r.amount,
    amountUSD: r.amountUSD,
    token: r.token,
    frequency: r.frequency,
    confidence: r.confidence,
    status: r.status,
    occurrences: r.occurrences,
    totalSpent: r.totalSpent,
    totalToken: r.totalToken,
    usdAvailable: r.usdAvailable,
    nextExpected: r.nextExpected ? new Date(r.nextExpected * 1000).toISOString() : undefined,
  }));

  return NextResponse.json({
    address,
    addressType: "evm",
    range,
    minValueUSD,
    totalOutflow: activity.totals.knownUsdOutgoing,
    totalInflow: activity.totals.knownUsdIncoming,
    monthlyBurn: activity.monthlyBurn,
    monthlyBurnTokens: activity.monthlyBurnTokens,
    runway,
    reserveScore,
    transactions: activity.events.map(toWalletTx),
    recurringPayments,
    spendByCategory: activity.spendByCategory,
    swapActivity: activity.swapActivity,
    aiInsights: [],
    topRecipients: activity.topRecipients,
    // ── extended treasury fields ──
    tokenOutflows: activity.totals.unknownPriceTokenOutgoing,
    tokenInflows: activity.totals.unknownPriceTokenIncoming,
    priceWarnings: activity.priceWarnings,
    nativeTransactionCount: activity.nativeTransactionCount,
    tokenTransferCount: activity.tokenTransferCount,
    ledgerEventCount: activity.ledgerEventCount,
    skippedCount: activity.skippedCount,
    skippedReasons: activity.skippedReasons,
    txCount: activity.nativeTransactionCount,
  });
}
