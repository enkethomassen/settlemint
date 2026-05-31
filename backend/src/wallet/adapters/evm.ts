import { walletConfig } from "../config";
import type { NormalizedTx, Direction } from "../types";

// EVM adapter — mirrors the role Helius plays for Solana in ACE Protocol.
// Uses Alchemy alchemy_getAssetTransfers (native + ERC-20, decimal-adjusted).
// Falls back to Etherscan public API if no Alchemy URL is set.

interface AlchemyTransfer {
  hash: string;
  from: string;
  to: string | null;
  value: number | null;
  asset: string | null;
  category: string;
  uniqueId: string;
  metadata?: { blockTimestamp?: string };
  rawContract?: { address?: string | null };
}

async function alchemyGetTransfers(
  address: string,
  direction: "from" | "to"
): Promise<AlchemyTransfer[]> {
  const url = walletConfig.alchemyUrl;
  if (!url) return [];

  const key = direction === "from" ? "fromAddress" : "toAddress";
  const body = {
    id: 1,
    jsonrpc: "2.0",
    method: "alchemy_getAssetTransfers",
    params: [
      {
        [key]: address,
        category: ["external", "erc20", "internal"],
        withMetadata: true,
        excludeZeroValue: true,
        maxCount: "0x3e8", // 1000
        order: "desc",
      },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) return [];
  const json = (await res.json()) as any;
  if (json.error) return [];
  return json.result?.transfers ?? [];
}

// Blockscout public API — free, no key, always works as a fallback.
async function blockscoutGetTxs(address: string): Promise<NormalizedTx[]> {
  const base = "https://eth.blockscout.com/api/v2";
  const addr = address.toLowerCase();

  // Fetch both sent and received in parallel
  const [res1, res2] = await Promise.all([
    fetch(`${base}/addresses/${address}/transactions`),
    fetch(`${base}/addresses/${address}/token-transfers`),
  ]);

  const txs: NormalizedTx[] = [];

  if (res1.ok) {
    const data = (await res1.json()) as any;
    const items: any[] = data?.items ?? [];

    for (const t of items) {
      if (t.status !== "ok" && t.result !== "success") continue;
      const from = (t.from?.hash ?? "").toLowerCase();
      const to = (t.to?.hash ?? "").toLowerCase();
      const dir: Direction = from === addr ? "out" : to === addr ? "in" : "self";
      const amount = t.value ? parseInt(t.value) / 1e18 : 0;
      const ts = t.timestamp ? Math.floor(new Date(t.timestamp).getTime() / 1000) : 0;

      txs.push({
        id: t.hash,
        chain: "evm",
        network: walletConfig.evmNetwork,
        hash: t.hash,
        timestamp: ts,
        direction: dir,
        from,
        to,
        counterparty: dir === "out" ? to : from,
        asset: "ETH",
        amount,
        valueUsd: null,
        isContract: !!t.to?.is_contract,
        raw: t,
      });
    }
  }

  return txs.filter((t) => t.timestamp > 0).sort((a, b) => b.timestamp - a.timestamp);
}

export async function fetchEvmHistory(address: string): Promise<NormalizedTx[]> {
  if (!walletConfig.alchemyUrl) {
    // No Alchemy key — use Blockscout (free, no key required)
    return blockscoutGetTxs(address);
  }

  const addr = address.toLowerCase();
  const [out, inn] = await Promise.all([
    alchemyGetTransfers(address, "from"),
    alchemyGetTransfers(address, "to"),
  ]);

  const seen = new Set<string>();
  const txs: NormalizedTx[] = [];

  for (const t of [...out, ...inn]) {
    if (seen.has(t.uniqueId)) continue;
    seen.add(t.uniqueId);

    const from = (t.from ?? "").toLowerCase();
    const to = (t.to ?? "").toLowerCase();
    let dir: Direction = "self";
    if (from === addr && to !== addr) dir = "out";
    else if (to === addr && from !== addr) dir = "in";

    const ts = t.metadata?.blockTimestamp
      ? Math.floor(new Date(t.metadata.blockTimestamp).getTime() / 1000)
      : 0;

    txs.push({
      id: t.uniqueId,
      chain: "evm",
      network: walletConfig.evmNetwork,
      hash: t.hash,
      timestamp: ts,
      direction: dir,
      from,
      to,
      counterparty: dir === "out" ? to : from,
      asset: (t.asset ?? "ETH").toUpperCase(),
      amount: t.value ?? 0,
      valueUsd: null,
      isContract: t.category === "erc20" || !!t.rawContract?.address,
      raw: t,
    });
  }

  return txs.filter((t) => t.timestamp > 0).sort((a, b) => b.timestamp - a.timestamp);
}
