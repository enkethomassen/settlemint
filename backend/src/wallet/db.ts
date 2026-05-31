import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { walletConfig } from "./config";
import type { CategorizedTx } from "./types";

mkdirSync(dirname(walletConfig.dbPath), { recursive: true });

const db = new Database(walletConfig.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS txs (
    id                TEXT PRIMARY KEY,
    address           TEXT NOT NULL,
    chain             TEXT NOT NULL,
    network           TEXT NOT NULL,
    hash              TEXT NOT NULL,
    timestamp         INTEGER NOT NULL,
    direction         TEXT NOT NULL,
    counterparty      TEXT NOT NULL,
    counterparty_label TEXT,
    asset             TEXT NOT NULL,
    amount            REAL NOT NULL,
    value_usd         REAL,
    category          TEXT NOT NULL,
    confidence        REAL NOT NULL,
    reason            TEXT NOT NULL,
    source            TEXT NOT NULL,
    raw               TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_txs_addr    ON txs(address);
  CREATE INDEX IF NOT EXISTS idx_txs_addr_ts ON txs(address, timestamp DESC);
`);

const upsert = db.prepare(`
  INSERT INTO txs
    (id,address,chain,network,hash,timestamp,direction,counterparty,
     counterparty_label,asset,amount,value_usd,category,confidence,reason,source,raw)
  VALUES
    (@id,@address,@chain,@network,@hash,@timestamp,@direction,@counterparty,
     @counterparty_label,@asset,@amount,@value_usd,@category,@confidence,@reason,@source,@raw)
  ON CONFLICT(id) DO UPDATE SET
    category=excluded.category, confidence=excluded.confidence,
    reason=excluded.reason, source=excluded.source, value_usd=excluded.value_usd
`);

export function saveTxs(address: string, txs: CategorizedTx[]): void {
  const insertMany = db.transaction((rows: CategorizedTx[]) => {
    for (const t of rows) {
      upsert.run({
        id: t.id,
        address: address.toLowerCase(),
        chain: t.chain,
        network: t.network,
        hash: t.hash,
        timestamp: t.timestamp,
        direction: t.direction,
        counterparty: t.counterparty,
        counterparty_label: t.counterpartyLabel ?? null,
        asset: t.asset,
        amount: t.amount,
        value_usd: t.valueUsd,
        category: t.category,
        confidence: t.confidence,
        reason: t.reason,
        source: t.source,
        raw: t.raw ? JSON.stringify(t.raw) : null,
      });
    }
  });
  insertMany(txs);
}

export function getTxs(address: string, limit = 500): CategorizedTx[] {
  const rows = db
    .prepare(`SELECT * FROM txs WHERE address=? ORDER BY timestamp DESC LIMIT ?`)
    .all(address.toLowerCase(), limit) as any[];

  return rows.map((r) => ({
    id: r.id,
    chain: r.chain,
    network: r.network,
    hash: r.hash,
    timestamp: r.timestamp,
    direction: r.direction,
    from: "",
    to: "",
    counterparty: r.counterparty,
    counterpartyLabel: r.counterparty_label,
    asset: r.asset,
    amount: r.amount,
    valueUsd: r.value_usd,
    category: r.category,
    confidence: r.confidence,
    reason: r.reason,
    source: r.source,
  }));
}

export default db;
