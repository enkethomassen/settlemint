import { NextRequest, NextResponse } from "next/server";

const MEZO_API = process.env.BLOCKSCOUT_BASE ?? "https://api.explorer.mezo.org";
const NATIVE_DECIMALS = 1e18;

async function fetchAddressInfo(address: string) {
  try {
    const res = await fetch(`${MEZO_API}/api/v2/addresses/${address}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json() as any;
  } catch { return null; }
}

async function fetchTransactions(address: string) {
  try {
    const res = await fetch(`${MEZO_API}/api/v2/addresses/${address}/transactions`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data?.items ?? [];
  } catch { return []; }
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

function categorize(tx: any, userAddress: string): string {
  const method = (tx.method ?? "").toLowerCase();
  const types: string[] = tx.tx_types ?? [];
  if (types.includes("contract_call")) {
    if (/swap|trade|exchange/.test(method)) return "swap";
    if (/stake|deposit|withdraw|yield|farm|liquidity/.test(method)) return "yield";
    if (/subscri|recurring|stream/.test(method)) return "subscription";
    if (/approve/.test(method)) return "gas";
    return "payment";
  }
  return "transfer";
}

function detectRecurring(outflows: any[]) {
  const byTo: Record<string, number[]> = {};
  for (const tx of outflows) {
    const key = tx.to.toLowerCase();
    if (!byTo[key]) byTo[key] = [];
    byTo[key].push(tx.timestamp);
  }
  const recurring = [];
  for (const [addr, times] of Object.entries(byTo)) {
    if (times.length < 2) continue;
    times.sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const variance = gaps.reduce((s, g) => s + Math.abs(g - avgGap), 0) / gaps.length;
    const isRegular = variance < avgGap * 0.35;
    const frequency =
      avgGap < 86400 * 2 ? "daily" :
      avgGap < 86400 * 10 ? "weekly" :
      "monthly";
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
    });
  }
  return recurring.sort((a, b) => b.totalSpent - a.totalSpent);
}

export async function POST(req: NextRequest) {
  const { address, addressType, range = "90d" } = await req.json();
  if (!address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  const isBTC =
    addressType === "bitcoin" ||
    /^(1|3)[a-zA-HJ-NP-Z0-9]{25,34}$/.test(address) ||
    /^bc1[a-zA-HJ-NP-Z0-9]{6,87}$/.test(address);

  const rangeDays = range === "30d" ? 30 : range === "180d" ? 180 : 90;
  const cutoffTs = Math.floor(Date.now() / 1000) - rangeDays * 86400;

  // ── BTC ────────────────────────────────────────────────────────────────────
  if (isBTC) {
    const raw = await fetchBTCData(address);
    if (!raw) return NextResponse.json({ error: "Failed to fetch BTC data" }, { status: 502 });

    const BTC_PRICE_USD = 73743;
    const balance = (raw.final_balance ?? 0) / 1e8;
    const txs: any[] = raw.txs ?? [];

    const transactions = txs.map((tx: any) => {
      const isOut = (tx.inputs ?? []).some((i: any) => i.prev_out?.addr === address);
      const valueRaw = isOut
        ? (tx.inputs ?? []).reduce((s: number, i: any) => i.prev_out?.addr === address ? s + (i.prev_out?.value ?? 0) : s, 0)
        : (tx.out ?? []).reduce((s: number, o: any) => o.addr === address ? s + (o.value ?? 0) : s, 0);
      const amount = valueRaw / 1e8;
      const amountUSD = amount * BTC_PRICE_USD;
      return {
        hash: tx.hash ?? "",
        timestamp: tx.time ?? 0,
        from: isOut ? address : "external",
        to: isOut ? "external" : address,
        amount,
        amountUSD,
        token: "BTC",
        category: "transfer",
        isFiltered: (tx.time ?? 0) < cutoffTs,
      };
    });

    const inRange = transactions.filter(t => !t.isFiltered);
    const outflows = inRange.filter(t => t.from === address);
    const totalOutflow = outflows.reduce((s, t) => s + t.amountUSD, 0);
    const monthlyBurn = totalOutflow / (rangeDays / 30);
    const balanceUSD = balance * BTC_PRICE_USD;
    const runway = monthlyBurn > 0 ? `${(balanceUSD / monthlyBurn).toFixed(1)} months` : "∞";
    const reserveScore = balance > 0.1 ? 90 : balance > 0.01 ? 70 : 40;

    return NextResponse.json({
      address,
      addressType: "bitcoin",
      range,
      totalOutflow,
      totalInflow: inRange.filter(t => t.to === address).reduce((s, t) => s + t.amountUSD, 0),
      monthlyBurn,
      runway,
      reserveScore,
      transactions,
      recurringPayments: detectRecurring(outflows),
      spendByCategory: totalOutflow > 0
        ? [{ category: "transfer", amountUSD: totalOutflow, percentage: 100 }]
        : [],
      aiInsights: [],
      topRecipients: [],
    });
  }

  // ── EVM / Mezo ─────────────────────────────────────────────────────────────
  const [addrInfo, txItems] = await Promise.all([
    fetchAddressInfo(address),
    fetchTransactions(address),
  ]);

  const exchangeRate = parseFloat(addrInfo?.exchange_rate ?? "73743");
  const balanceWei = parseFloat(addrInfo?.coin_balance ?? "0");
  const balance = balanceWei / NATIVE_DECIMALS;
  const balanceUSD = balance * exchangeRate;

  const addrLower = address.toLowerCase();

  const transactions = (txItems as any[]).map((tx: any) => {
    const ts = tx.timestamp
      ? Math.floor(new Date(tx.timestamp).getTime() / 1000)
      : 0;
    const fromAddr = (tx.from?.hash ?? "").toLowerCase();
    const toAddr = (tx.to?.hash ?? tx.to ?? "").toLowerCase();
    const isOut = fromAddr === addrLower;
    const valueRaw = parseFloat(tx.value ?? "0");
    const amount = valueRaw / NATIVE_DECIMALS;
    const amountUSD = amount * exchangeRate;
    const category = categorize(tx, address);

    return {
      hash: tx.hash ?? "",
      timestamp: ts,
      from: tx.from?.hash ?? "",
      to: tx.to?.hash ?? tx.to ?? "",
      amount,
      amountUSD,
      token: "BTC",
      category,
      isFiltered: ts < cutoffTs,
      filterReason: ts < cutoffTs ? `Outside ${range} range` : undefined,
    };
  });

  const inRange = transactions.filter(t => !t.isFiltered);
  const outflows = inRange.filter(t => t.from.toLowerCase() === addrLower);
  const inflows = inRange.filter(t => t.to.toLowerCase() === addrLower);
  const totalOutflow = outflows.reduce((s, t) => s + t.amountUSD, 0);
  const totalInflow = inflows.reduce((s, t) => s + t.amountUSD, 0);
  const monthlyBurn = totalOutflow / (rangeDays / 30);
  const runway = monthlyBurn > 0 ? `${(balanceUSD / monthlyBurn).toFixed(1)} months` : "∞";

  // Category breakdown
  const catMap: Record<string, number> = {};
  for (const tx of outflows) {
    catMap[tx.category] = (catMap[tx.category] ?? 0) + tx.amountUSD;
  }
  const spendByCategory = Object.entries(catMap)
    .map(([category, amountUSD]) => ({
      category,
      amountUSD,
      percentage: totalOutflow > 0 ? Math.round((amountUSD / totalOutflow) * 100) : 0,
    }))
    .sort((a, b) => b.amountUSD - a.amountUSD);

  // Top recipients
  const recipientMap: Record<string, { totalUSD: number; count: number }> = {};
  for (const tx of outflows) {
    const r = tx.to.toLowerCase();
    if (!recipientMap[r]) recipientMap[r] = { totalUSD: 0, count: 0 };
    recipientMap[r].totalUSD += tx.amountUSD;
    recipientMap[r].count++;
  }
  const topRecipients = Object.entries(recipientMap)
    .map(([addr, { totalUSD, count }]) => ({ address: addr, totalUSD, count }))
    .sort((a, b) => b.totalUSD - a.totalUSD)
    .slice(0, 10);

  const reserveScore = balanceUSD > 1000 ? 90 : balanceUSD > 100 ? 75 : balanceUSD > 10 ? 55 : 30;

  return NextResponse.json({
    address,
    addressType: "evm",
    range,
    totalOutflow,
    totalInflow,
    monthlyBurn,
    runway,
    reserveScore,
    transactions,
    recurringPayments: detectRecurring(outflows),
    spendByCategory,
    aiInsights: [],
    topRecipients,
    txCount: txItems.length,
  });
}
