import type { CategorizedTx, Insights, Chain } from "../types";
import { groupByCounterparty } from "./groups";

// Builds the dashboard payload from categorized transactions.
// Mirrors ACE Protocol's InsightsFeed / CashflowSummary components.

export function buildInsights(address: string, chain: Chain, txs: CategorizedTx[]): Insights {
  const network = txs[0]?.network ?? "";
  const now = Math.floor(Date.now() / 1000);
  const earliest = txs.reduce((m, t) => Math.min(m, t.timestamp), now);
  const windowDays = Math.max(1, Math.round((now - earliest) / 86400));

  let inflowUsd = 0;
  let outflowUsd = 0;
  const byCategory: Record<string, { count: number; totalUsd: number }> = {};

  for (const t of txs) {
    const usd = t.valueUsd ?? 0;
    if (t.direction === "in") inflowUsd += usd;
    if (t.direction === "out") outflowUsd += usd;
    const c = (byCategory[t.category] ??= { count: 0, totalUsd: 0 });
    c.count++;
    c.totalUsd += usd;
  }

  const groups = groupByCounterparty(txs);

  const recurring = groups
    .filter((g) => g.count >= 3 && g.intervalCV != null && g.intervalCV < 0.4)
    .map((g) => {
      const sample = txs.find((t) => t.counterparty === g.counterparty);
      return {
        counterparty: g.counterparty,
        label: g.counterpartyLabel,
        category: (sample?.category ?? "transfer") as any,
        cadenceDays: g.meanIntervalDays,
        typicalUsd: g.totalUsd / g.count,
        occurrences: g.count,
      };
    })
    .sort((a, b) => b.occurrences - a.occurrences);

  // Flag transactions whose USD value is a large outlier vs the wallet's typical.
  const usdVals = txs.map((t) => t.valueUsd ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
  const median = usdVals.length ? usdVals[Math.floor(usdVals.length / 2)] : 0;
  const anomalies = txs
    .filter((t) => (t.valueUsd ?? 0) > median * 10 && median > 0)
    .slice(0, 10)
    .map((t) => ({
      txId: t.id,
      reason: `Value ~$${(t.valueUsd ?? 0).toFixed(0)} is >10× the median tx ($${median.toFixed(0)})`,
      valueUsd: t.valueUsd,
    }));

  const topCounterparties = groups
    .map((g) => ({
      counterparty: g.counterparty,
      label: g.counterpartyLabel,
      totalUsd: g.totalUsd,
      count: g.count,
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .slice(0, 10);

  return {
    address,
    chain,
    network,
    txCount: txs.length,
    windowDays,
    inflowUsd,
    outflowUsd,
    netUsd: inflowUsd - outflowUsd,
    byCategory,
    recurring,
    anomalies,
    topCounterparties,
  };
}
