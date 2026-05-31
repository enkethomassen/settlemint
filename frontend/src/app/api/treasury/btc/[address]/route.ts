import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;
  const valid =
    /^(1|3)[a-zA-HJ-NP-Z0-9]{25,34}$/.test(address) ||
    /^bc1[a-zA-HJ-NP-Z0-9]{6,87}$/.test(address);

  if (!valid) {
    return NextResponse.json({ error: "Invalid BTC address" }, { status: 400 });
  }

  // Try mempool.space first (more reliable), fall back to blockchain.info
  const sources = [
    {
      url: `https://mempool.space/api/address/${address}`,
      transform: async (data: any) => {
        const txRes = await fetch(`https://mempool.space/api/address/${address}/txs`);
        const txs = txRes.ok ? await txRes.json() : [];
        const funded = data.chain_stats?.funded_txo_sum ?? 0;
        const spent = data.chain_stats?.spent_txo_sum ?? 0;
        const final_balance = funded - spent;
        return {
          final_balance,
          n_tx: data.chain_stats?.tx_count ?? 0,
          txs: txs.slice(0, 50).map((tx: any) => ({
            hash: tx.txid,
            time: tx.status?.block_time ?? Math.floor(Date.now() / 1000),
            result: tx.vout?.reduce((s: number, o: any) =>
              o.scriptpubkey_address === address ? s + o.value : s, 0) ?? 0,
            inputs: tx.vin?.map((i: any) => ({
              prev_out: {
                addr: i.prevout?.scriptpubkey_address ?? "",
                value: i.prevout?.value ?? 0,
              },
            })) ?? [],
          })),
        };
      },
    },
    {
      url: `https://blockchain.info/rawaddr/${address}?limit=50&cors=true`,
      transform: async (data: any) => data,
    },
  ];

  for (const source of sources) {
    try {
      const response = await fetch(source.url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      const raw = await response.json();
      const data = await source.transform(raw);
      return NextResponse.json(data);
    } catch {
      continue;
    }
  }

  return NextResponse.json(
    { error: "Failed to fetch BTC data — all sources unavailable" },
    { status: 503 }
  );
}
