import type { CategorizedTx } from "../types";
import { walletConfig } from "../config";
import { llm, parseJsonLoose } from "./provider";

// Agentic refinement layer — only the transactions the heuristic engine was
// unsure about (confidence < AI_CONFIDENCE_THRESHOLD) get sent to the LLM,
// batched into a single call. This is cheap enough for free-tier providers.

const SYSTEM = `You are a crypto treasury analyst. Classify each on-chain transaction into exactly one category:
subscription, bill, invoice, payroll, grant, swap, deposit, withdrawal, refund, transfer, fee, unknown.

Definitions:
- subscription: recurring outbound, regular cadence, stable amount (SaaS, memberships).
- bill: recurring outbound, regular cadence, variable amount (utilities, usage-based).
- invoice: one-off outbound payment to a vendor/contractor.
- payroll: recurring monthly outbound, large stable amount, to a wallet.
- grant: large inbound, infrequent, from a treasury/multisig/program.
- swap: interaction with a DEX/aggregator.
- deposit/withdrawal: moving funds in/out of an exchange or contract.
- refund: inbound reversal of a prior outbound.
- transfer: a plain move with no clearer meaning.
- fee/unknown: protocol fees or genuinely unclear.

Return ONLY a JSON array. Each element: {"id": "<tx id>", "category": "<category>", "confidence": <0-1>, "reason": "<short>"}.`;

interface LlmVerdict {
  id: string;
  category: CategorizedTx["category"];
  confidence: number;
  reason: string;
}

export async function refineWithLlm(txs: CategorizedTx[]): Promise<CategorizedTx[]> {
  if (walletConfig.ai.provider === "none") return txs;

  const ambiguous = txs.filter((t) => t.confidence < walletConfig.ai.confidenceThreshold);
  if (ambiguous.length === 0) return txs;

  // Send compact features only — never raw payloads.
  const payload = ambiguous.map((t) => ({
    id: t.id,
    direction: t.direction,
    asset: t.asset,
    amount: Number(t.amount.toPrecision(4)),
    valueUsd: t.valueUsd != null ? Math.round(t.valueUsd) : null,
    counterparty: t.counterpartyLabel ?? t.counterparty.slice(0, 10),
    isContract: t.isContract ?? false,
    heuristicGuess: t.category,
  }));

  let verdicts: LlmVerdict[] | null = null;
  try {
    const out = await llm(SYSTEM, `Classify these transactions:\n${JSON.stringify(payload)}`);
    verdicts = parseJsonLoose<LlmVerdict[]>(out);
  } catch (e) {
    // LLM unavailable / rate-limited — keep heuristic result, don't crash.
    console.warn("[wallet-ai] refine failed, keeping heuristics:", (e as Error).message);
    return txs;
  }

  if (!verdicts) return txs;

  const byId = new Map(verdicts.map((v) => [v.id, v]));
  return txs.map((t) => {
    const v = byId.get(t.id);
    if (!v) return t;
    return {
      ...t,
      category: v.category,
      confidence: Math.max(t.confidence, Math.min(1, v.confidence ?? 0.6)),
      reason: v.reason || t.reason,
      source: "llm" as const,
    };
  });
}
