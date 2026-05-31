import type { NormalizedTx, CategorizedTx, CounterpartyGroup, Category } from "../types";
import { groupByCounterparty } from "./groups";

// Heuristic categorizer — runs first, deterministic, explainable, zero cost.
// The LLM layer (ai/categorizeLLM.ts) only handles low-confidence leftovers.
//
// Tune thresholds here. Add known addresses to LABELS to get exact categories.
// In production hydrate LABELS from Etherscan labels, your CRM, or a grants list.

const LABELS: Record<string, { label: string; category?: Category }> = {
  // Example: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d": { label: "Uniswap V2 Router", category: "swap" },
};

// DEX routers — always mark as swap and filter from expense analysis.
const DEX_ROUTERS = new Set([
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
  "0xe592427a0aece92de3edee1f18e0157c05861564",
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
  "0x1111111254fb6c44bac0bed2854e76f90643097d",
  "0x1111111254eeb25477b68fb85ed929f73a960582",
  "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f",
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff",
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad",
]);

const MONTHLY = (d: number) => d >= 26 && d <= 35;
const WEEKLY = (d: number) => d >= 6 && d <= 8;
const DAILY = (d: number) => d >= 0.5 && d <= 1.5;

function categorizeGroup(g: CounterpartyGroup): { category: Category; confidence: number; reason: string } {
  // DEX router shortcut
  if (DEX_ROUTERS.has(g.counterparty.toLowerCase())) {
    return { category: "swap", confidence: 0.95, reason: "Known DEX router address" };
  }

  const known = LABELS[g.counterparty.toLowerCase()];
  if (known?.category) {
    return { category: known.category, confidence: 0.95, reason: `Known address: "${known.label}"` };
  }

  const recurring = g.count >= 3;
  const regularCadence = g.intervalCV != null && g.intervalCV < 0.35;
  const stableAmount = g.amountCV < 0.15;
  const cadence = g.meanIntervalDays;

  if (g.direction === "out") {
    if (recurring && regularCadence && stableAmount) {
      // Large stable monthly outflow to an EOA wallet looks like payroll.
      if (cadence && MONTHLY(cadence) && g.totalUsd / g.count > 800 && !g.isContract) {
        return {
          category: "payroll",
          confidence: 0.8,
          reason: `Regular monthly outflow (~${cadence.toFixed(0)}d), stable large amount to wallet`,
        };
      }
      const periodic = cadence && (MONTHLY(cadence) || WEEKLY(cadence) || DAILY(cadence));
      return {
        category: "subscription",
        confidence: periodic ? 0.85 : 0.7,
        reason: `Recurring (${g.count}x), regular cadence (~${cadence?.toFixed(0)}d), stable amount`,
      };
    }

    if (recurring && regularCadence && cadence && MONTHLY(cadence) && !stableAmount) {
      return { category: "bill", confidence: 0.72, reason: "Recurring monthly, variable amount (utilities)" };
    }

    const avgOutUsd = g.count ? g.totalUsd / g.count : 0;
    if (g.count <= 2 && avgOutUsd >= 50) {
      return { category: "invoice", confidence: 0.55, reason: "One-off outbound payment" };
    }

    return { category: "transfer", confidence: 0.5, reason: "Outbound transfer" };
  }

  if (g.direction === "in") {
    const avgUsd = g.totalUsd / g.count;
    if (avgUsd >= 2000 && g.count <= 4) {
      return {
        category: "grant",
        confidence: g.isContract ? 0.7 : 0.55,
        reason: `Large inbound (~$${avgUsd.toFixed(0)}), few occurrences — grant/funding pattern`,
      };
    }
    if (recurring && regularCadence && stableAmount && cadence && MONTHLY(cadence)) {
      return { category: "deposit", confidence: 0.7, reason: "Regular monthly inbound, stable amount (salary?)" };
    }
    if (g.isContract) {
      return { category: "withdrawal", confidence: 0.55, reason: "Inbound from contract (DEX/CEX)" };
    }
    return { category: "deposit", confidence: 0.5, reason: "Inbound transfer" };
  }

  return { category: "unknown", confidence: 0.3, reason: "Unclassified" };
}

export function categorizeHeuristic(txs: NormalizedTx[]): CategorizedTx[] {
  const groups = groupByCounterparty(txs);
  const verdict = new Map<string, { category: Category; confidence: number; reason: string }>();

  for (const g of groups) {
    const v = categorizeGroup(g);
    for (const t of g.txs) verdict.set(t.id, v);
  }

  return txs.map((t) => {
    const v = verdict.get(t.id) ?? {
      category: "unknown" as Category,
      confidence: 0.3,
      reason: "Self-transfer or ungrouped",
    };
    return { ...t, category: v.category, confidence: v.confidence, reason: v.reason, source: "heuristic" as const };
  });
}
