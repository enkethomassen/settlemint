export type Chain = "evm" | "btc";
export type Direction = "in" | "out" | "self";

export type Category =
  | "subscription"
  | "bill"
  | "invoice"
  | "payroll"
  | "grant"
  | "swap"
  | "deposit"
  | "withdrawal"
  | "refund"
  | "transfer"
  | "fee"
  | "unknown";

export interface NormalizedTx {
  id: string;
  chain: Chain;
  network: string;
  hash: string;
  timestamp: number;
  direction: Direction;
  from: string;
  to: string;
  counterparty: string;
  asset: string;
  amount: number;
  valueUsd: number | null;
  counterpartyLabel?: string | null;
  isContract?: boolean;
  memo?: string | null;
  raw?: unknown;
}

export interface CategorizedTx extends NormalizedTx {
  category: Category;
  confidence: number;
  reason: string;
  source: "heuristic" | "llm";
}

export interface CounterpartyGroup {
  counterparty: string;
  counterpartyLabel?: string | null;
  asset: string;
  direction: Direction;
  txs: NormalizedTx[];
  count: number;
  totalUsd: number;
  meanAmount: number;
  amountCV: number;
  meanIntervalDays: number | null;
  intervalCV: number | null;
  isContract: boolean;
}

export interface Insights {
  address: string;
  chain: Chain;
  network: string;
  txCount: number;
  windowDays: number;
  inflowUsd: number;
  outflowUsd: number;
  netUsd: number;
  byCategory: Record<string, { count: number; totalUsd: number }>;
  recurring: Array<{
    counterparty: string;
    label?: string | null;
    category: Category;
    cadenceDays: number | null;
    typicalUsd: number;
    occurrences: number;
  }>;
  anomalies: Array<{ txId: string; reason: string; valueUsd: number | null }>;
  topCounterparties: Array<{ counterparty: string; label?: string | null; totalUsd: number; count: number }>;
}
