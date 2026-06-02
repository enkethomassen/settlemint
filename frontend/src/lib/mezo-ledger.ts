// ─────────────────────────────────────────────────────────────────────────────
// Mezo treasury ledger normalization
//
// Pure, dependency-free helpers that turn raw Mezo Blockscout responses
// (native transactions + ERC-20 token transfers) into a single normalized
// ledger of TreasuryLedgerEvents, then derive monthly burn, recurring
// patterns, category breakdown and swap activity from that ledger.
//
// This module performs NO network I/O so it can be unit-tested in isolation.
// The /api/wallet/analyze route is responsible for fetching + pagination and
// hands the raw arrays to buildMezoActivity().
//
// Design rules (see audit3.md):
//   • Token transfers are first-class — one event per transfer.
//   • A transaction hash can contain many transfers (do not collapse).
//   • USD is OPTIONAL, token units are MANDATORY. Unknown price ≠ $0.
//   • Self transfers are excluded from spend / burn / recurring.
// ─────────────────────────────────────────────────────────────────────────────

export type Direction = "incoming" | "outgoing" | "self" | "unknown";

export type LedgerKind =
  | "native_transfer"
  | "token_transfer"
  | "contract_call"
  | "swap"
  | "internal"
  | "unknown";

// Reuse the category union the existing UI already understands.
export type TreasuryCategory =
  | "payment" | "subscription" | "yield" | "swap"
  | "gas" | "transfer" | "stablecoin" | "nft" | "unknown";

export type UsdPriceSource =
  | "coingecko" | "musd_peg" | "stablecoin_peg" | "native_price" | "explorer_rate" | "unavailable";

export interface TreasuryLedgerEvent {
  id: string;               // chain:txHash:logIndex | chain:txHash:native
  chain: string;
  txHash: string;
  timestamp: number;        // unix seconds
  direction: Direction;
  from: string;
  to: string;
  counterparty: string | null;
  kind: LedgerKind;
  tokenSymbol: string;
  tokenName?: string;
  tokenAddress?: string;
  tokenDecimals?: number;
  rawAmount: string;
  tokenAmount: number;
  usdValue: number | null;
  usdPriceSource: UsdPriceSource;
  usdAvailable: boolean;
  displayValue: string;     // e.g. "42.72 MEZO"
  displayUsd: string | null; // e.g. "$42.72" | null
  category: TreasuryCategory;
  // present so the event can be filtered out of treasury math without dropping it
  isFiltered: boolean;
  filterReason?: string;
}

export interface RecurringPattern {
  toAddress: string;
  toLabel?: string;
  amount: number;
  amountUSD: number;
  token: string;
  frequency: "weekly" | "biweekly" | "monthly" | "daily" | "irregular";
  confidence: number;
  status: "possible" | "confirmed";
  occurrences: number;
  totalSpent: number;        // USD total for known-price events, else 0
  totalToken: number;        // always available (token-denominated)
  usdAvailable: boolean;
  lastDate: number;
  nextExpected?: number;
}

// ── Raw Blockscout shapes (only the fields we read) ──────────────────────────
export interface RawAddressRef { hash?: string; name?: string | null; }
export interface RawToken {
  address?: string;
  symbol?: string;
  name?: string;
  decimals?: string | null;
  exchange_rate?: string | null;
  type?: string;
}
export interface RawTokenTransfer {
  tx_hash?: string;
  transaction_hash?: string;
  log_index?: number | string;
  timestamp?: string;
  method?: string;
  from?: RawAddressRef;
  to?: RawAddressRef;
  token?: RawToken;
  total?: { value?: string; decimals?: string | null };
  type?: string;
}
export interface RawNativeTx {
  hash?: string;
  timestamp?: string;
  value?: string;
  method?: string | null;
  tx_types?: string[];
  raw_input?: string;
  input?: string;
  from?: RawAddressRef;
  to?: RawAddressRef;
}

// Mezo native gas asset is BTC. MEZO is a separate ERC-20.
export const NATIVE_SYMBOL = "BTC";
export const NATIVE_DECIMALS = 18;
const STABLECOINS = new Set(["MUSD", "USDC", "USDT", "DAI", "USDB", "USDE", "FRAX"]);
const BTC_LIKE = new Set(["BTC", "WBTC", "TBTC", "CBBTC"]);

// ── Primitive helpers ─────────────────────────────────────────────────────────

const lc = (s: string | undefined | null) => (s ?? "").toLowerCase();

export function parseTokenAmount(rawValue: string | undefined, decimals: number): number {
  if (!rawValue) return 0;
  const d = Number.isFinite(decimals) && decimals >= 0 ? decimals : 18;
  // BigInt-safe integer/fraction split so large balances keep precision.
  let neg = false;
  let s = rawValue.trim();
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  if (!/^\d+$/.test(s)) {
    const n = Number(rawValue) / 10 ** d;
    return Number.isFinite(n) ? n : 0;
  }
  const padded = s.padStart(d + 1, "0");
  const intPart = padded.slice(0, padded.length - d) || "0";
  const fracPart = d > 0 ? padded.slice(padded.length - d) : "";
  const num = Number(`${intPart}.${fracPart}`);
  return neg ? -num : num;
}

export function detectDirection(from: string, to: string, user: string): Direction {
  const f = lc(from), t = lc(to), u = lc(user);
  if (!u) return "unknown";
  const isFrom = f === u, isTo = t === u;
  if (isFrom && isTo) return "self";
  if (isFrom) return "outgoing";
  if (isTo) return "incoming";
  return "unknown";
}

export interface PriceResolution { usd: number | null; source: UsdPriceSource; }

// Resolve a per-unit USD price. btcPrice covers the native asset + wrapped BTC.
// mezoPrice covers the MEZO governance token (fetched from DeFiLlama by the route).
export function resolvePrice(
  token: { symbol?: string; exchange_rate?: string | null; isNative?: boolean },
  btcPrice: number | null,
  mezoPrice?: number | null,
): PriceResolution {
  const sym = (token.symbol ?? "").toUpperCase();
  if (sym === "MUSD") return { usd: 1, source: "musd_peg" };
  if (STABLECOINS.has(sym)) return { usd: 1, source: "stablecoin_peg" };
  if (token.isNative || BTC_LIKE.has(sym)) {
    return btcPrice != null ? { usd: btcPrice, source: "native_price" } : { usd: null, source: "unavailable" };
  }
  if (sym === "MEZO" && mezoPrice != null && mezoPrice > 0) {
    return { usd: mezoPrice, source: "explorer_rate" };
  }
  // Explorer sometimes carries a live exchange_rate per token.
  if (token.exchange_rate != null && token.exchange_rate !== "") {
    const r = Number.parseFloat(token.exchange_rate);
    if (Number.isFinite(r) && r > 0) return { usd: r, source: "explorer_rate" };
  }
  return { usd: null, source: "unavailable" };
}

function fmtUSD(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}

function fmtToken(amount: number, symbol: string): string {
  // Trim to a sensible precision without scientific notation.
  const abs = Math.abs(amount);
  const decimals = abs >= 1 ? 4 : abs >= 0.0001 ? 6 : 8;
  const s = amount
    .toFixed(decimals)
    .replace(/\.?0+$/, "");
  return `${s || "0"} ${symbol}`;
}

// ── Categorization ────────────────────────────────────────────────────────────

function categorizeNative(tx: RawNativeTx): TreasuryCategory {
  const method = lc(tx.method);
  const types = tx.tx_types ?? [];
  if (types.includes("contract_call")) {
    if (/swap|trade|exchange/.test(method)) return "swap";
    if (/stake|deposit|withdraw|yield|farm|liquidity/.test(method)) return "yield";
    if (/subscri|recurring|stream/.test(method)) return "subscription";
    if (/approve/.test(method)) return "gas";
    return "payment";
  }
  return "transfer";
}

function categorizeToken(symbol: string, direction: Direction): TreasuryCategory {
  if (STABLECOINS.has(symbol.toUpperCase())) {
    // Outgoing stablecoin = payment; incoming = receiving liquidity (stablecoin)
    return direction === "outgoing" ? "payment" : "stablecoin";
  }
  return "transfer";
}

// ── Normalizers ─────────────────────────────────────────────────────────────

export function normalizeTokenTransfer(
  raw: RawTokenTransfer,
  user: string,
  btcPrice: number | null,
  chain = "mezo",
  mezoPrice?: number | null,
): TreasuryLedgerEvent {
  const txHash = raw.tx_hash ?? raw.transaction_hash ?? "";
  const logIndex = raw.log_index ?? "0";
  const from = raw.from?.hash ?? "";
  const to = raw.to?.hash ?? "";
  const token = raw.token ?? {};
  const symbol = token.symbol ?? "?";
  const decimals = Number.parseInt(raw.total?.decimals ?? token.decimals ?? "18", 10) || 18;
  const rawAmount = raw.total?.value ?? "0";
  const tokenAmount = parseTokenAmount(rawAmount, decimals);
  const direction = detectDirection(from, to, user);

  const price = resolvePrice({ symbol, exchange_rate: token.exchange_rate }, btcPrice, mezoPrice);
  const usdValue = price.usd != null ? tokenAmount * price.usd : null;

  const counterparty = direction === "incoming" ? from : direction === "outgoing" ? to : null;

  return {
    id: `${chain}:${txHash}:${logIndex}`,
    chain,
    txHash,
    timestamp: raw.timestamp ? Math.floor(new Date(raw.timestamp).getTime() / 1000) : 0,
    direction,
    from,
    to,
    counterparty,
    kind: "token_transfer",
    tokenSymbol: symbol,
    tokenName: token.name,
    tokenAddress: token.address ? token.address.toLowerCase() : undefined,
    tokenDecimals: decimals,
    rawAmount,
    tokenAmount,
    usdValue,
    usdPriceSource: price.source,
    usdAvailable: usdValue != null,
    displayValue: fmtToken(tokenAmount, symbol),
    displayUsd: usdValue != null ? fmtUSD(usdValue) : null,
    category: categorizeToken(symbol, direction),
    isFiltered: false,
  };
}

export function normalizeNativeTx(
  raw: RawNativeTx,
  user: string,
  btcPrice: number | null,
  chain = "mezo",
): TreasuryLedgerEvent {
  const txHash = raw.hash ?? "";
  const from = raw.from?.hash ?? "";
  const to = raw.to?.hash ?? "";
  const tokenAmount = parseTokenAmount(raw.value, NATIVE_DECIMALS);
  const direction = detectDirection(from, to, user);
  const price = resolvePrice({ symbol: NATIVE_SYMBOL, isNative: true }, btcPrice);
  const usdValue = price.usd != null ? tokenAmount * price.usd : null;
  const counterparty = direction === "incoming" ? from : direction === "outgoing" ? to : null;
  const category = categorizeNative(raw);

  return {
    id: `${chain}:${txHash}:native`,
    chain,
    txHash,
    timestamp: raw.timestamp ? Math.floor(new Date(raw.timestamp).getTime() / 1000) : 0,
    direction,
    from,
    to,
    counterparty,
    kind: tokenAmount > 0 ? "native_transfer" : "contract_call",
    tokenSymbol: NATIVE_SYMBOL,
    tokenDecimals: NATIVE_DECIMALS,
    rawAmount: raw.value ?? "0",
    tokenAmount,
    usdValue,
    usdPriceSource: price.source,
    usdAvailable: usdValue != null,
    displayValue: fmtToken(tokenAmount, NATIVE_SYMBOL),
    displayUsd: usdValue != null ? fmtUSD(usdValue) : null,
    category,
    isFiltered: false,
  };
}

// ── Noise filtering ───────────────────────────────────────────────────────────
// We never drop real token transfers just because their USD price is unknown.
function markNoise(ev: TreasuryLedgerEvent, minValueUSD: number): TreasuryLedgerEvent {
  if (ev.direction === "self") {
    return { ...ev, isFiltered: true, filterReason: "Self transfer" };
  }
  // Native contract call with no value movement and no token transfer → noise.
  if (ev.kind === "contract_call" && ev.tokenAmount === 0) {
    return { ...ev, isFiltered: true, filterReason: "Contract call, no value moved" };
  }
  // Gas-only native dust (tiny BTC, priced, below threshold). Token transfers
  // with unknown USD are explicitly NOT filtered here.
  if (
    ev.kind === "native_transfer" &&
    ev.usdAvailable &&
    (ev.usdValue ?? 0) < minValueUSD &&
    ev.tokenAmount < 0.0001
  ) {
    return { ...ev, isFiltered: true, filterReason: `Below $${minValueUSD.toFixed(2)} dust` };
  }
  return ev;
}

// ── Swap detection ────────────────────────────────────────────────────────────
// A tx that moves one token OUT and a different token IN (same hash) is a swap.
function markSwaps(events: TreasuryLedgerEvent[]): TreasuryLedgerEvent[] {
  const byHash: Record<string, TreasuryLedgerEvent[]> = {};
  for (const e of events) {
    if (e.kind !== "token_transfer" && e.kind !== "native_transfer") continue;
    (byHash[e.txHash] ??= []).push(e);
  }
  const swapHashes = new Set<string>();
  for (const [hash, group] of Object.entries(byHash)) {
    const hasOut = group.some(e => e.direction === "outgoing");
    const hasIn = group.some(e => e.direction === "incoming");
    const symbols = new Set(group.map(e => e.tokenSymbol));
    if (hasOut && hasIn && symbols.size > 1) swapHashes.add(hash);
  }
  if (swapHashes.size === 0) return events;
  return events.map(e => (swapHashes.has(e.txHash) ? { ...e, category: "swap" as TreasuryCategory, kind: "swap" as LedgerKind } : e));
}

// ── Recurring detection ─────────────────────────────────────────────────────
// Works on token amount + symbol so it functions even with unknown USD price.
export function detectRecurring(outflows: TreasuryLedgerEvent[]): RecurringPattern[] {
  const groups: Record<string, TreasuryLedgerEvent[]> = {};
  for (const e of outflows) {
    const key = `${lc(e.to)}|${e.tokenSymbol}`;
    (groups[key] ??= []).push(e);
  }

  const patterns: RecurringPattern[] = [];
  for (const events of Object.values(groups)) {
    if (events.length < 2) continue;
    events.sort((a, b) => a.timestamp - b.timestamp);

    // amount clustering: keep events within ±5% of the median amount
    const amounts = events.map(e => e.tokenAmount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const similar = events.filter(e => median === 0 || Math.abs(e.tokenAmount - median) <= median * 0.05);
    if (similar.length < 2) continue;

    const times = similar.map(e => e.timestamp).sort((a, b) => a - b);
    const gapsDays = times.slice(1).map((t, i) => (t - times[i]) / 86400);
    const avgGap = gapsDays.reduce((s, g) => s + g, 0) / gapsDays.length;

    let frequency: RecurringPattern["frequency"];
    if (avgGap >= 0.5 && avgGap <= 2) frequency = "daily";
    else if (avgGap >= 6 && avgGap <= 8) frequency = "weekly";
    else if (avgGap >= 13 && avgGap <= 15) frequency = "biweekly";
    else if (avgGap >= 27 && avgGap <= 33) frequency = "monthly";
    else frequency = "irregular";

    // regularity → confidence
    const variance = gapsDays.reduce((s, g) => s + Math.abs(g - avgGap), 0) / gapsDays.length;
    const regular = avgGap > 0 && variance < avgGap * 0.35 && frequency !== "irregular";
    const occurrences = similar.length;
    const status: RecurringPattern["status"] = occurrences >= 3 ? "confirmed" : "possible";
    const confidence = Math.min(
      0.95,
      (regular ? 0.6 : 0.4) + (occurrences >= 3 ? 0.25 : 0.1) + (frequency !== "irregular" ? 0.1 : 0),
    );

    const usdAvailable = similar.every(e => e.usdAvailable);
    const lastDate = times[times.length - 1];
    const nextExpected = frequency !== "irregular" ? lastDate + Math.round(avgGap * 86400) : undefined;
    const ref = similar[similar.length - 1];

    patterns.push({
      toAddress: ref.to,
      toLabel: ref.counterparty ?? undefined,
      amount: median,
      amountUSD: usdAvailable ? (ref.usdValue ?? 0) : 0,
      token: ref.tokenSymbol,
      frequency,
      confidence,
      status,
      occurrences,
      totalSpent: similar.reduce((s, e) => s + (e.usdValue ?? 0), 0),
      totalToken: similar.reduce((s, e) => s + e.tokenAmount, 0),
      usdAvailable,
      lastDate,
      nextExpected,
    });
  }

  return patterns.sort((a, b) => b.occurrences - a.occurrences || b.totalToken - a.totalToken);
}

// ── Activity builder ──────────────────────────────────────────────────────────

export interface BuildInput {
  address: string;
  range: string;
  rangeDays: number;
  nativeTxs: RawNativeTx[];
  tokenTransfers: RawTokenTransfer[];
  btcPrice: number | null;
  mezoPrice?: number | null;     // MEZO governance token price from DeFiLlama
  minValueUSD?: number;
  includeUnknownPrice?: boolean; // default true
  nowSec?: number;               // injectable for tests
}

export interface MezoActivity {
  address: string;
  chain: "mezo";
  range: string;
  nativeTransactionCount: number;
  tokenTransferCount: number;
  ledgerEventCount: number;
  skippedCount: number;
  skippedReasons: Record<string, number>;
  events: TreasuryLedgerEvent[];
  totals: {
    knownUsdIncoming: number;
    knownUsdOutgoing: number;
    knownUsdNet: number;
    unknownPriceTokenIncoming: Record<string, number>;
    unknownPriceTokenOutgoing: Record<string, number>;
  };
  monthlyBurn: number;
  monthlyBurnTokens: Record<string, number>;
  recurringPatterns: RecurringPattern[];
  spendByCategory: { category: string; amountUSD: number; percentage: number }[];
  swapActivity: { count: number; volumeUSD: number };
  topRecipients: { address: string; label?: string; totalUSD: number; totalToken: number; token: string; count: number }[];
  priceWarnings: string[];
}

export function buildMezoActivity(input: BuildInput): MezoActivity {
  const {
    address, range, rangeDays, nativeTxs, tokenTransfers, btcPrice, mezoPrice,
    minValueUSD = 1.0, nowSec = Math.floor(Date.now() / 1000),
  } = input;
  const cutoff = nowSec - rangeDays * 86400;

  // Normalize everything.
  const rawEvents: TreasuryLedgerEvent[] = [
    ...tokenTransfers.map(t => normalizeTokenTransfer(t, address, btcPrice, "mezo", mezoPrice)),
    ...nativeTxs.map(t => normalizeNativeTx(t, address, btcPrice)),
  ];

  // Range filter (out-of-range events dropped from the ledger entirely).
  const inRange = rawEvents.filter(e => e.timestamp === 0 || e.timestamp >= cutoff);

  // Swap detection before noise filtering so swaps keep their category.
  const swapped = markSwaps(inRange);

  // Noise classification (kept in the ledger, flagged via isFiltered).
  const events = swapped.map(e => markNoise(e, minValueUSD));

  const skippedReasons: Record<string, number> = {};
  let skippedCount = 0;
  for (const e of events) {
    if (e.isFiltered) {
      skippedCount++;
      const reason = e.filterReason ?? "filtered";
      skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
    }
  }

  // Treasury math runs on meaningful, non-swap, non-self events only.
  const meaningful = events.filter(e => !e.isFiltered);
  const nonSwap = meaningful.filter(e => e.category !== "swap" && e.direction !== "self");
  const outgoing = nonSwap.filter(e => e.direction === "outgoing");
  const incoming = nonSwap.filter(e => e.direction === "incoming");

  const knownUsdOutgoing = outgoing.reduce((s, e) => s + (e.usdValue ?? 0), 0);
  const knownUsdIncoming = incoming.reduce((s, e) => s + (e.usdValue ?? 0), 0);

  const unknownPriceTokenOutgoing: Record<string, number> = {};
  const unknownPriceTokenIncoming: Record<string, number> = {};
  for (const e of outgoing) if (!e.usdAvailable) unknownPriceTokenOutgoing[e.tokenSymbol] = (unknownPriceTokenOutgoing[e.tokenSymbol] ?? 0) + e.tokenAmount;
  for (const e of incoming) if (!e.usdAvailable) unknownPriceTokenIncoming[e.tokenSymbol] = (unknownPriceTokenIncoming[e.tokenSymbol] ?? 0) + e.tokenAmount;

  const months = Math.max(rangeDays / 30, 1 / 30);
  const monthlyBurn = knownUsdOutgoing / months;
  const monthlyBurnTokens: Record<string, number> = {};
  for (const [sym, amt] of Object.entries(unknownPriceTokenOutgoing)) monthlyBurnTokens[sym] = amt / months;

  // Category breakdown (known-USD outgoing).
  const catMap: Record<string, number> = {};
  for (const e of outgoing) if (e.usdValue) catMap[e.category] = (catMap[e.category] ?? 0) + e.usdValue;
  const spendByCategory = Object.entries(catMap)
    .map(([category, amountUSD]) => ({
      category,
      amountUSD,
      percentage: knownUsdOutgoing > 0 ? Math.round((amountUSD / knownUsdOutgoing) * 100) : 0,
    }))
    .sort((a, b) => b.amountUSD - a.amountUSD);

  // Swaps.
  const swaps = meaningful.filter(e => e.category === "swap");
  const swapHashes = new Set(swaps.map(e => e.txHash));
  const swapActivity = {
    count: swapHashes.size,
    volumeUSD: swaps.reduce((s, e) => s + (e.usdValue ?? 0), 0),
  };

  // Top recipients (token-aware).
  const recip: Record<string, { totalUSD: number; totalToken: number; token: string; count: number; label?: string }> = {};
  for (const e of outgoing) {
    const key = lc(e.to);
    const r = (recip[key] ??= { totalUSD: 0, totalToken: 0, token: e.tokenSymbol, count: 0 });
    r.totalUSD += e.usdValue ?? 0;
    r.totalToken += e.tokenAmount;
    r.count++;
  }
  const topRecipients = Object.entries(recip)
    .map(([address, v]) => ({ address, ...v }))
    .sort((a, b) => b.totalUSD - a.totalUSD || b.totalToken - a.totalToken)
    .slice(0, 10);

  const recurringPatterns = detectRecurring(outgoing);

  // Price warnings.
  const priceWarnings: string[] = [];
  const unknownSyms = new Set([...Object.keys(unknownPriceTokenOutgoing), ...Object.keys(unknownPriceTokenIncoming)]);
  for (const sym of unknownSyms) {
    priceWarnings.push(`USD price unavailable for ${sym}; showing token-denominated activity.`);
  }
  if (btcPrice == null) priceWarnings.push("BTC price unavailable; native values shown token-denominated.");

  return {
    address,
    chain: "mezo",
    range,
    nativeTransactionCount: nativeTxs.length,
    tokenTransferCount: tokenTransfers.length,
    ledgerEventCount: events.length,
    skippedCount,
    skippedReasons,
    events,
    totals: {
      knownUsdIncoming,
      knownUsdOutgoing,
      knownUsdNet: knownUsdIncoming - knownUsdOutgoing,
      unknownPriceTokenIncoming,
      unknownPriceTokenOutgoing,
    },
    monthlyBurn,
    monthlyBurnTokens,
    recurringPatterns,
    spendByCategory,
    swapActivity,
    topRecipients,
    priceWarnings,
  };
}
