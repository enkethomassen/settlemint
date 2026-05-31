import { walletConfig } from "../config";
import type { NormalizedTx, Direction } from "../types";

// BTC adapter — Esplora REST API (mempool.space / Blockstream), free, no key.
// Bitcoin is UTXO-based so direction and counterparty are derived from
// which inputs/outputs involve the scanned address.

interface EsploraVin {
  prevout?: { scriptpubkey_address?: string; value?: number };
}
interface EsploraVout {
  scriptpubkey_address?: string;
  value?: number;
}
interface EsploraTx {
  txid: string;
  status: { confirmed: boolean; block_time?: number };
  vin: EsploraVin[];
  vout: EsploraVout[];
}

const SATS = 1e8;

export async function fetchBtcHistory(address: string): Promise<NormalizedTx[]> {
  const base = walletConfig.btcEsploraBase;
  const res = await fetch(`${base}/address/${address}/txs`);
  if (!res.ok) throw new Error(`Esplora error ${res.status}: ${await res.text()}`);
  const raw = (await res.json()) as EsploraTx[];

  const txs: NormalizedTx[] = [];

  for (const tx of raw) {
    const inputsFromUs = tx.vin
      .filter((v) => v.prevout?.scriptpubkey_address === address)
      .reduce((s, v) => s + (v.prevout?.value ?? 0), 0);

    const outputsToUs = tx.vout
      .filter((v) => v.scriptpubkey_address === address)
      .reduce((s, v) => s + (v.value ?? 0), 0);

    const spent = inputsFromUs > 0;
    const received = outputsToUs > 0;

    let dir: Direction;
    let amountSats: number;
    let counterparty: string;

    if (spent && !received) {
      dir = "out";
      amountSats = tx.vout
        .filter((v) => v.scriptpubkey_address !== address)
        .reduce((s, v) => s + (v.value ?? 0), 0);
      counterparty =
        tx.vout.find((v) => v.scriptpubkey_address && v.scriptpubkey_address !== address)
          ?.scriptpubkey_address ?? "unknown";
    } else if (received && !spent) {
      dir = "in";
      amountSats = outputsToUs;
      counterparty =
        tx.vin.find((v) => v.prevout?.scriptpubkey_address)?.prevout?.scriptpubkey_address ??
        "unknown";
    } else {
      dir = "self";
      amountSats = Math.abs(outputsToUs - inputsFromUs);
      counterparty = address;
    }

    txs.push({
      id: tx.txid,
      chain: "btc",
      network: "bitcoin",
      hash: tx.txid,
      timestamp: tx.status.block_time ?? Math.floor(Date.now() / 1000),
      direction: dir,
      from: dir === "out" ? address : counterparty,
      to: dir === "out" ? counterparty : address,
      counterparty,
      asset: "BTC",
      amount: amountSats / SATS,
      valueUsd: null,
      isContract: false,
      raw: tx,
    });
  }

  return txs.sort((a, b) => b.timestamp - a.timestamp);
}
