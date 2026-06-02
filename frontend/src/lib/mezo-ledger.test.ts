// Run with:  node --test src/lib/mezo-ledger.test.ts   (Node ≥ 22, type-stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTokenAmount,
  detectDirection,
  resolvePrice,
  normalizeTokenTransfer,
  buildMezoActivity,
  type RawTokenTransfer,
  type RawNativeTx,
} from "./mezo-ledger.ts";

const USER = "0x1b41Ea04c09370cd20eCf61E27b93fD9e16b0C06";
const OTHER = "0x03ffb3720214bDB0DB5F5F71b6cE16B008f762d2";

// Real Blockscout token-transfer shape (MEZO, no exchange_rate).
function mezoTransfer(opts: { from: string; to: string; value: string; ts: string; hash?: string; index?: number }): RawTokenTransfer {
  return {
    tx_hash: opts.hash ?? "0xhash",
    log_index: opts.index ?? 0,
    timestamp: opts.ts,
    method: "transfer",
    from: { hash: opts.from },
    to: { hash: opts.to },
    token: { address: "0x7B7c000000000000000000000000000000000001", symbol: "MEZO", name: "MEZO", decimals: "18", exchange_rate: null },
    total: { value: opts.value, decimals: "18" },
    type: "token_transfer",
  };
}

function musdTransfer(opts: { from: string; to: string; value: string; ts: string }): RawTokenTransfer {
  return {
    tx_hash: "0xmusd",
    log_index: 1,
    timestamp: opts.ts,
    from: { hash: opts.from },
    to: { hash: opts.to },
    token: { address: "0xmusd", symbol: "MUSD", name: "Mezo USD", decimals: "18", exchange_rate: null },
    total: { value: opts.value, decimals: "18" },
  };
}

// ── 1. token amount parsing ──────────────────────────────────────────────────
test("parseTokenAmount handles 18-decimal raw integers without precision loss", () => {
  assert.equal(parseTokenAmount("42720000000000000000", 18), 42.72);
  assert.equal(parseTokenAmount("21000000000000000000", 18), 21);
  assert.equal(parseTokenAmount("4720000000000000000", 18), 4.72);
  assert.equal(parseTokenAmount("0", 18), 0);
  assert.equal(parseTokenAmount("1000000", 6), 1); // 6-decimal stablecoin
});

test("normalizeTokenTransfer never treats raw integer as human amount", () => {
  const ev = normalizeTokenTransfer(mezoTransfer({ from: OTHER, to: USER, value: "42720000000000000000", ts: "2026-05-20T03:33:13.000000Z" }), USER, null);
  assert.equal(ev.tokenAmount, 42.72);
  assert.equal(ev.tokenSymbol, "MEZO");
  assert.equal(ev.displayValue, "42.72 MEZO");
});

// ── 2. direction detection ───────────────────────────────────────────────────
test("detectDirection classifies incoming/outgoing/self", () => {
  assert.equal(detectDirection(USER, OTHER, USER), "outgoing");
  assert.equal(detectDirection(OTHER, USER, USER), "incoming");
  assert.equal(detectDirection(USER, USER, USER), "self");
  assert.equal(detectDirection(OTHER, OTHER, USER), "unknown");
});

// ── pricing ──────────────────────────────────────────────────────────────────
test("resolvePrice pegs MUSD/stablecoins and leaves MEZO unavailable", () => {
  assert.deepEqual(resolvePrice({ symbol: "MUSD" }, null), { usd: 1, source: "musd_peg" });
  assert.deepEqual(resolvePrice({ symbol: "USDC" }, null), { usd: 1, source: "stablecoin_peg" });
  assert.deepEqual(resolvePrice({ symbol: "MEZO", exchange_rate: null }, 100000), { usd: null, source: "unavailable" });
  assert.deepEqual(resolvePrice({ symbol: "BTC", isNative: true }, 100000), { usd: 100000, source: "native_price" });
});

// ── 6. unknown USD must NOT render as $0.00 ─────────────────────────────────
test("unknown-price MEZO event exposes null USD (not zero)", () => {
  const ev = normalizeTokenTransfer(mezoTransfer({ from: USER, to: OTHER, value: "42720000000000000000", ts: "2026-05-20T00:00:00Z" }), USER, 100000);
  assert.equal(ev.usdValue, null);
  assert.equal(ev.usdAvailable, false);
  assert.equal(ev.displayUsd, null);
  assert.equal(ev.usdPriceSource, "unavailable");
});

// ── 3. monthly burn: known / unknown / mixed ─────────────────────────────────
const NOW = Math.floor(new Date("2026-06-01T00:00:00Z").getTime() / 1000);
const iso = (daysAgo: number) => new Date((NOW - daysAgo * 86400) * 1000).toISOString();

test("monthly burn — known USD (MUSD) outgoing", () => {
  const a = buildMezoActivity({
    address: USER, range: "90d", rangeDays: 90, btcPrice: 100000, nowSec: NOW,
    nativeTxs: [],
    tokenTransfers: [
      musdTransfer({ from: USER, to: OTHER, value: "30000000000000000000", ts: iso(10) }), // 30 MUSD out
      musdTransfer({ from: USER, to: OTHER, value: "60000000000000000000", ts: iso(40) }), // 60 MUSD out
    ],
  });
  assert.equal(a.totals.knownUsdOutgoing, 90);
  assert.equal(a.monthlyBurn, 30); // 90 USD over 3 months
});

test("monthly burn — unknown USD (MEZO) reported token-denominated, not $0", () => {
  const a = buildMezoActivity({
    address: USER, range: "90d", rangeDays: 90, btcPrice: 100000, nowSec: NOW,
    nativeTxs: [],
    tokenTransfers: [
      mezoTransfer({ from: USER, to: OTHER, value: "42720000000000000000", ts: iso(5), hash: "0xa" }),
      mezoTransfer({ from: USER, to: OTHER, value: "21000000000000000000", ts: iso(35), hash: "0xb" }),
    ],
  });
  assert.equal(a.monthlyBurn, 0);                       // no known USD
  assert.equal(a.totals.knownUsdOutgoing, 0);
  assert.equal(Math.round(a.totals.unknownPriceTokenOutgoing.MEZO * 100) / 100, 63.72);
  assert.ok(a.monthlyBurnTokens.MEZO > 0);              // token-denominated burn present
  assert.ok(a.priceWarnings.some(w => w.includes("MEZO")));
});

test("monthly burn — mixed incoming/outgoing nets correctly", () => {
  const a = buildMezoActivity({
    address: USER, range: "90d", rangeDays: 90, btcPrice: 100000, nowSec: NOW,
    nativeTxs: [],
    tokenTransfers: [
      musdTransfer({ from: OTHER, to: USER, value: "100000000000000000000", ts: iso(10) }), // 100 in
      musdTransfer({ from: USER, to: OTHER, value: "40000000000000000000", ts: iso(20) }),  // 40 out
    ],
  });
  assert.equal(a.totals.knownUsdIncoming, 100);
  assert.equal(a.totals.knownUsdOutgoing, 40);
  assert.equal(a.totals.knownUsdNet, 60);
});

// ── 4. recurring detection over repeated MEZO transfers ──────────────────────
test("recurring detection finds monthly MEZO payments without USD price", () => {
  const a = buildMezoActivity({
    address: USER, range: "180d", rangeDays: 180, btcPrice: 100000, nowSec: NOW,
    nativeTxs: [],
    tokenTransfers: [
      mezoTransfer({ from: USER, to: OTHER, value: "10000000000000000000", ts: iso(90), hash: "0x1" }),
      mezoTransfer({ from: USER, to: OTHER, value: "10000000000000000000", ts: iso(60), hash: "0x2" }),
      mezoTransfer({ from: USER, to: OTHER, value: "10000000000000000000", ts: iso(30), hash: "0x3" }),
    ],
  });
  assert.equal(a.recurringPatterns.length, 1);
  const r = a.recurringPatterns[0];
  assert.equal(r.token, "MEZO");
  assert.equal(r.frequency, "monthly");
  assert.equal(r.occurrences, 3);
  assert.equal(r.status, "confirmed");
  assert.equal(r.usdAvailable, false);
  assert.equal(r.totalToken, 30);
  assert.ok(r.nextExpected && r.nextExpected > NOW - 30 * 86400);
});

// ── self transfers excluded from burn/recurring ──────────────────────────────
test("self transfers are filtered out of treasury math", () => {
  const a = buildMezoActivity({
    address: USER, range: "90d", rangeDays: 90, btcPrice: 100000, nowSec: NOW,
    nativeTxs: [],
    tokenTransfers: [musdTransfer({ from: USER, to: USER, value: "50000000000000000000", ts: iso(5) })],
  });
  assert.equal(a.totals.knownUsdOutgoing, 0);
  assert.equal(a.skippedCount, 1);
  assert.ok("Self transfer" in a.skippedReasons);
});

// ── swap detection: out one token + in another in same tx ───────────────────
test("swap (out MEZO / in MUSD in same hash) is categorized swap, not spend", () => {
  const a = buildMezoActivity({
    address: USER, range: "90d", rangeDays: 90, btcPrice: 100000, nowSec: NOW,
    nativeTxs: [],
    tokenTransfers: [
      { tx_hash: "0xswap", log_index: 0, timestamp: iso(3), from: { hash: USER }, to: { hash: OTHER },
        token: { symbol: "MEZO", decimals: "18", exchange_rate: null }, total: { value: "10000000000000000000", decimals: "18" } },
      { tx_hash: "0xswap", log_index: 1, timestamp: iso(3), from: { hash: OTHER }, to: { hash: USER },
        token: { symbol: "MUSD", decimals: "18", exchange_rate: null }, total: { value: "12000000000000000000", decimals: "18" } },
    ],
  });
  assert.equal(a.swapActivity.count, 1);
  assert.equal(a.totals.knownUsdOutgoing, 0); // swap excluded from spend
  assert.equal(a.recurringPatterns.length, 0);
});

// ── 5. paginated merge: builder ingests 50+ transfers across pages ───────────
test("builder ingests a 50+ transfer ledger (multi-page merge equivalent)", () => {
  const transfers: RawTokenTransfer[] = [];
  for (let i = 0; i < 55; i++) {
    transfers.push(mezoTransfer({ from: OTHER, to: USER, value: "1000000000000000000", ts: iso(i + 1), hash: `0x${i}`, index: 0 }));
  }
  const a = buildMezoActivity({ address: USER, range: "90d", rangeDays: 90, btcPrice: 100000, nowSec: NOW, nativeTxs: [], tokenTransfers: transfers });
  assert.equal(a.tokenTransferCount, 55);
  assert.equal(a.events.filter(e => e.direction === "incoming").length, 55);
});

// native contract-call noise (value 0) is excluded but real native transfer kept
test("native contract-call with no value moved is filtered; valued native transfer kept", () => {
  const nativeTxs: RawNativeTx[] = [
    { hash: "0xc1", timestamp: iso(2), value: "0", method: "transfer", tx_types: ["contract_call", "token_transfer"], from: { hash: USER }, to: { hash: OTHER } },
    { hash: "0xn1", timestamp: iso(4), value: "5000000000000000", from: { hash: USER }, to: { hash: OTHER }, tx_types: ["coin_transfer"] }, // 0.005 BTC
  ];
  const a = buildMezoActivity({ address: USER, range: "90d", rangeDays: 90, btcPrice: 100000, nowSec: NOW, nativeTxs, tokenTransfers: [] });
  const contractCall = a.events.find(e => e.txHash === "0xc1");
  const nativeXfer = a.events.find(e => e.txHash === "0xn1");
  assert.equal(contractCall?.isFiltered, true);
  assert.equal(nativeXfer?.isFiltered, false);
  assert.ok(a.totals.knownUsdOutgoing > 0); // 0.005 BTC * 100000 = $500
});
