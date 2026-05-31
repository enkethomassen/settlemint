import type { Chain, CategorizedTx, Insights } from "./types";
import { fetchEvmHistory } from "./adapters/evm";
import { fetchBtcHistory } from "./adapters/btc";
import { enrichWithUsd } from "./adapters/prices";
import { categorizeHeuristic } from "./engine/categorize";
import { refineWithLlm } from "./ai/categorizeLLM";
import { buildInsights } from "./engine/insights";
import { saveTxs, getTxs } from "./db";

// The ACE-Protocol-style pipeline:
//   scan history → USD enrich → heuristic tag → LLM refine → store → insights

export async function scanWallet(
  address: string,
  chain: Chain
): Promise<{ transactions: CategorizedTx[]; insights: Insights }> {
  // 1. Pull on-chain history (chain-specific adapter)
  const raw = chain === "evm"
    ? await fetchEvmHistory(address)
    : await fetchBtcHistory(address);

  // 2. Attach USD value via CoinGecko spot prices
  const enriched = await enrichWithUsd(raw);

  // 3. Deterministic heuristic tagging
  const heuristic = categorizeHeuristic(enriched);

  // 4. Agentic refinement of low-confidence txs only (no-op if AI_PROVIDER=none)
  const refined = await refineWithLlm(heuristic);

  // 5. Persist + build dashboard payload
  saveTxs(address, refined);
  const insights = buildInsights(address, chain, refined);

  return { transactions: refined, insights };
}

export { getTxs, buildInsights };
