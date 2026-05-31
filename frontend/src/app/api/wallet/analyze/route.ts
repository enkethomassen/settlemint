import { NextRequest, NextResponse } from "next/server";

// Lightweight wallet analysis — proxies to Blockscout/mempool.space, no backend needed

const BLOCKSCOUT_BASE = process.env.BLOCKSCOUT_BASE ?? "https://api.explorer.mezo.org";

async function analyzeEVM(address: string) {
  const [balRes, txRes] = await Promise.all([
    fetch(`${BLOCKSCOUT_BASE}/api/v2/addresses/${address}`, { signal: AbortSignal.timeout(8000) }),
    fetch(`${BLOCKSCOUT_BASE}/api/v2/addresses/${address}/transactions?filter=to%7Cfrom&limit=50`, {
      signal: AbortSignal.timeout(10000),
    }),
  ]);

  const balData = balRes.ok ? await balRes.json() as any : {};
  const txData = txRes.ok ? await txRes.json() as any : {};

  const rawBalance = balData?.coin_balance ?? "0";
  const balance = rawBalance.startsWith("0x")
    ? parseInt(rawBalance, 16) / 1e18
    : parseFloat(rawBalance) / 1e18;

  const items: any[] = txData?.items ?? [];
  const cutoff = Math.floor(Date.now() / 1000) - 90 * 86400;
  let totalOut = 0;
  for (const tx of items) {
    const ts = tx.timestamp ? Math.floor(new Date(tx.timestamp).getTime() / 1000) : 0;
    if (ts < cutoff) continue;
    if ((tx.from?.hash ?? tx.from ?? "").toLowerCase() === address.toLowerCase()) {
      totalOut += parseFloat(tx.value ?? "0") / 1e18;
    }
  }

  const monthlyBurn = totalOut / 3;
  return { balance, txCount: items.length, monthlyBurn, totalOut, items };
}

async function analyzeBTC(address: string) {
  const res = await fetch(`https://mempool.space/api/address/${address}`, {
    signal: AbortSignal.timeout(8000),
  });
  const txRes = await fetch(`https://mempool.space/api/address/${address}/txs`, {
    signal: AbortSignal.timeout(8000),
  });

  const data = res.ok ? await res.json() as any : {};
  const txs = txRes.ok ? await txRes.json() as any[] : [];

  const funded = data?.chain_stats?.funded_txo_sum ?? 0;
  const spent = data?.chain_stats?.spent_txo_sum ?? 0;
  const balance = (funded - spent) / 1e8;
  const txCount = data?.chain_stats?.tx_count ?? 0;

  const ninetyDays = 90 * 86400;
  const now = Math.floor(Date.now() / 1000);
  let totalOut = 0;
  for (const tx of txs) {
    if (now - (tx.status?.block_time ?? now) > ninetyDays) continue;
    for (const inp of tx.vin ?? []) {
      if (inp.prevout?.scriptpubkey_address === address) {
        totalOut += inp.prevout.value / 1e8;
      }
    }
  }

  return { balance, txCount, monthlyBurn: totalOut / 3, totalOut, txs };
}

export async function POST(req: NextRequest) {
  const { address, addressType } = await req.json();
  if (!address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  const isBTC =
    addressType === "bitcoin" ||
    /^(1|3)[a-zA-HJ-NP-Z0-9]{25,34}$/.test(address) ||
    /^bc1[a-zA-HJ-NP-Z0-9]{6,87}$/.test(address);

  try {
    if (isBTC) {
      const { balance, txCount, monthlyBurn } = await analyzeBTC(address);
      return NextResponse.json({
        address,
        addressType: "bitcoin",
        range: "90d",
        totalOutflow: monthlyBurn * 3,
        totalInflow: balance,
        monthlyBurn,
        runway: monthlyBurn > 0 ? `${(balance / monthlyBurn).toFixed(1)} months` : "∞",
        reserveScore: balance > 0 ? 80 : 10,
        transactions: [],
        recurringPayments: [],
        spendByCategory: [],
        aiInsights: [],
        topRecipients: [],
        txCount,
      });
    } else {
      const { balance, txCount, monthlyBurn } = await analyzeEVM(address);
      return NextResponse.json({
        address,
        addressType: "evm",
        range: "90d",
        totalOutflow: monthlyBurn * 3,
        totalInflow: balance,
        monthlyBurn,
        runway: monthlyBurn > 0 ? `${(balance / monthlyBurn).toFixed(1)} months` : "∞",
        reserveScore: balance > 0.1 ? 95 : balance > 0.01 ? 65 : 30,
        transactions: [],
        recurringPayments: [],
        spendByCategory: [],
        aiInsights: [],
        topRecipients: [],
        txCount,
      });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Analysis failed" }, { status: 500 });
  }
}
