import type { Insights } from "../types";
import { walletConfig } from "../config";
import { llm } from "./provider";

// Natural-language treasury summary — the "AI insights" narration.
// Always returns a deterministic fallback when no LLM is configured.

export async function summarize(insights: Insights): Promise<string> {
  const top = insights.recurring
    .slice(0, 3)
    .map(
      (r) =>
        `${r.label ?? r.counterparty.slice(0, 8)} (${r.category}, ~$${r.typicalUsd.toFixed(0)} every ${r.cadenceDays?.toFixed(0) ?? "?"}d)`
    )
    .join("; ");

  const deterministic =
    `Over ~${insights.windowDays} days: $${insights.inflowUsd.toFixed(0)} in, ` +
    `$${insights.outflowUsd.toFixed(0)} out (net $${insights.netUsd.toFixed(0)}). ` +
    `${insights.recurring.length} recurring counterpart${insights.recurring.length === 1 ? "y" : "ies"}` +
    (top ? `: ${top}.` : ".") +
    (insights.anomalies.length
      ? ` ${insights.anomalies.length} unusual transaction(s) flagged.`
      : "");

  if (walletConfig.ai.provider === "none") return deterministic;

  try {
    const out = await llm(
      "You are a treasury analyst. Write a 3-4 sentence plain-English summary of this wallet's financial behavior. Mention cash flow, recurring commitments, and any risks. No markdown, no preamble.",
      JSON.stringify({
        windowDays: insights.windowDays,
        inflowUsd: Math.round(insights.inflowUsd),
        outflowUsd: Math.round(insights.outflowUsd),
        byCategory: insights.byCategory,
        recurring: insights.recurring.slice(0, 6),
        anomalies: insights.anomalies.length,
      })
    );
    return out.trim() || deterministic;
  } catch {
    return deterministic;
  }
}
