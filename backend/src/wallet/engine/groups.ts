import type { NormalizedTx, CounterpartyGroup, Direction } from "../types";

// Groups transactions by (counterparty + asset + direction) and computes
// statistical shape — cadence regularity and amount stability.
// These two numbers drive subscription/bill/payroll detection in categorize.ts.

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function cv(xs: number[]): number {
  const m = mean(xs);
  return m === 0 ? 0 : stddev(xs) / m;
}

export function groupByCounterparty(txs: NormalizedTx[]): CounterpartyGroup[] {
  const map = new Map<string, NormalizedTx[]>();

  for (const t of txs) {
    if (t.direction === "self") continue;
    const key = `${t.counterparty}|${t.asset}|${t.direction}`;
    const existing = map.get(key);
    if (existing) existing.push(t);
    else map.set(key, [t]);
  }

  const groups: CounterpartyGroup[] = [];

  for (const [, list] of map) {
    const sorted = [...list].sort((a, b) => a.timestamp - b.timestamp);
    const amounts = sorted.map((t) => t.amount);
    const usd = sorted.map((t) => t.valueUsd ?? 0);

    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push((sorted[i].timestamp - sorted[i - 1].timestamp) / 86400);
    }

    groups.push({
      counterparty: sorted[0].counterparty,
      counterpartyLabel: sorted[0].counterpartyLabel ?? null,
      asset: sorted[0].asset,
      direction: sorted[0].direction as Direction,
      txs: sorted,
      count: sorted.length,
      totalUsd: usd.reduce((a, b) => a + b, 0),
      meanAmount: mean(amounts),
      amountCV: cv(amounts),
      meanIntervalDays: intervals.length ? mean(intervals) : null,
      intervalCV: intervals.length >= 2 ? cv(intervals) : null,
      isContract: sorted.some((t) => t.isContract),
    });
  }

  return groups;
}
