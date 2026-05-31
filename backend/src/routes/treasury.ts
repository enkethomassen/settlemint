/**
 * routes/treasury.ts — Treasury analysis proxy + OpenAI agent
 *
 * Why this exists:
 *   - Etherscan returns "NOTOK" when called from browser without API key (CORS + rate limits)
 *   - Proxying through backend attaches the server-side API key and bypasses CORS entirely
 *   - OpenAI agent route provides GPT-powered cashflow insights
 */

import { Router, Request, Response } from "express";
import { logger } from "../logger";
import { forecastCashflow, type VaultSnapshot, type PaymentHistoryEntry } from "../agents/forecastAgent";

const router = Router();

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

// Blockscout public API — free, no key, no rate-limit issues
const BLOCKSCOUT_BASE = process.env.BLOCKSCOUT_BASE ?? "https://eth.blockscout.com";

// ─── EVM proxy via Blockscout (replaces deprecated Etherscan v1) ──────────────

router.get("/evm/:address/balance", async (req: Request, res: Response) => {
  const { address } = req.params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: "Invalid EVM address" });
  }
  try {
    const url = `${BLOCKSCOUT_BASE}/api/v2/addresses/${address}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      // fallback: Blockscout returned non-200 — return zero balance
      return res.json({ status: "1", result: "0" });
    }
    const data = await response.json() as any;
    // Blockscout v2 returns coin_balance in wei (string)
    const balanceWei = data?.coin_balance ?? "0";
    // Return in Etherscan-compatible format so the frontend doesn't need to change
    res.json({ status: "1", result: balanceWei });
  } catch (err: any) {
    logger.error("Blockscout balance proxy failed", { address, error: err.message });
    // Return zero rather than error — better UX, analyzer still runs
    res.json({ status: "1", result: "0" });
  }
});

router.get("/evm/:address/txlist", async (req: Request, res: Response) => {
  const { address } = req.params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: "Invalid EVM address" });
  }
  try {
    // No filter/limit params — Blockscout v2 rejects them and returns empty results.
    const url = `${BLOCKSCOUT_BASE}/api/v2/addresses/${address}/transactions`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      return res.json({ status: "1", result: [] });
    }
    const data = await response.json() as any;
    const items: any[] = data?.items ?? [];

    // Normalize to Etherscan-compatible format so WalletAnalyzer doesn't need changes
    const normalized = items.map((tx: any) => ({
      hash: tx.hash ?? "",
      // Blockscout timestamp is ISO string — convert to unix seconds
      timeStamp: tx.timestamp
        ? String(Math.floor(new Date(tx.timestamp).getTime() / 1000))
        : "0",
      from: tx.from?.hash ?? tx.from ?? "",
      to:   tx.to?.hash   ?? tx.to   ?? "",
      value: tx.value ?? "0",
      isError: tx.status === "error" ? "1" : "0",
      txreceipt_status: tx.status === "ok" ? "1" : "0",
      gas: String(tx.gas_limit ?? 21000),
      gasUsed: String(tx.gas_used ?? 21000),
      gasPrice: String(tx.gas_price ?? 0),
    }));

    res.json({ status: "1", result: normalized });
  } catch (err: any) {
    logger.error("Blockscout txlist proxy failed", { address, error: err.message });
    res.json({ status: "1", result: [] });
  }
});

router.get("/btc/:address", async (req: Request, res: Response) => {
  const { address } = req.params;
  if (
    !/^(1|3)[a-zA-HJ-NP-Z0-9]{25,34}$/.test(address) &&
    !/^bc1[a-zA-HJ-NP-Z0-9]{6,87}$/.test(address)
  ) {
    return res.status(400).json({ error: "Invalid BTC address" });
  }
  try {
    const url = `https://blockchain.info/rawaddr/${address}?limit=50&cors=true`;
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: `blockchain.info returned ${response.status}` });
    }
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    logger.error("BTC proxy failed", { address, error: err.message });
    res.status(500).json({ error: "Failed to fetch BTC data" });
  }
});

// ─── OpenAI Treasury Agent ────────────────────────────────────────────────────
// POST /api/treasury/analyze — runs GPT agent over treasury snapshot

interface TreasurySnapshot {
  address: string;
  type: "btc" | "evm";
  balance: number;
  txCount: number;
  monthlyBurn: number;
  runway: number | null;
  reserveScore: number;
  recentTxs: Array<{ hash: string; time: string; value: string; direction: string }>;
}

router.post("/analyze", async (req: Request, res: Response) => {
  const snapshot = req.body as TreasurySnapshot;

  if (!snapshot?.address) {
    return res.status(400).json({ error: "Treasury snapshot required" });
  }

  if (!OPENAI_KEY) {
    // Return a deterministic heuristic analysis when no OpenAI key is set
    const insights = buildHeuristicInsights(snapshot);
    return res.json({ insights, model: "heuristic", powered_by: "built-in" });
  }

  try {
    const systemPrompt = `You are a Bitcoin treasury analyst AI for Settlemint — a Bitcoin-native cashflow automation system built on the Mezo network.
Your job is to analyze on-chain treasury data and provide concise, actionable insights.
Respond with a JSON object containing:
- "summary": one sentence treasury health summary (max 25 words)
- "insights": array of 3-4 bullet insights (each max 20 words, start with an emoji)
- "risks": array of 1-2 identified risks or concerns (max 20 words each)
- "recommendation": one actionable recommendation for automating cashflow via Settlemint (max 30 words)
- "health": "healthy" | "caution" | "critical"`;

    const userPrompt = `Analyze this treasury:
Address: ${snapshot.address} (${snapshot.type === "btc" ? "Bitcoin" : "EVM/Ethereum"})
Balance: ${snapshot.balance.toFixed(6)} ${snapshot.type === "btc" ? "BTC" : "ETH"}
Monthly Burn Rate: ${snapshot.monthlyBurn > 0 ? snapshot.monthlyBurn.toFixed(6) : "0"} ${snapshot.type === "btc" ? "BTC" : "ETH"}
Runway: ${snapshot.runway ? `${snapshot.runway.toFixed(1)} months` : "Infinite (no outflows)"}
Total Transactions: ${snapshot.txCount}
Reserve Score: ${snapshot.reserveScore}/100
Recent Activity: ${snapshot.recentTxs.length} recent transactions analyzed`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error: ${response.status} — ${err}`);
    }

    const aiData = await response.json() as any;
    const content = JSON.parse(aiData.choices[0].message.content);
    res.json({ ...content, model: "gpt-4o-mini", powered_by: "openai" });
  } catch (err: any) {
    logger.error("OpenAI treasury analysis failed", { error: err.message });
    // Fall back to heuristic analysis on OpenAI failure
    const insights = buildHeuristicInsights(snapshot);
    res.json({ insights, model: "heuristic", powered_by: "built-in", fallback: true });
  }
});

// ─── POST /api/treasury/forecast ─────────────────────────────────────────────

router.post("/forecast", async (req: Request, res: Response) => {
  const { vault, history } = req.body as {
    vault?: VaultSnapshot;
    history?: PaymentHistoryEntry[];
  };

  if (!vault?.address) {
    return res.status(400).json({ error: "vault snapshot required" });
  }

  try {
    const forecast = await forecastCashflow(vault, history ?? []);
    res.json(forecast);
  } catch (err: any) {
    logger.error("Forecast failed", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── Heuristic fallback analysis (no OpenAI key needed) ──────────────────────

function buildHeuristicInsights(s: TreasurySnapshot) {
  const ticker = s.type === "btc" ? "BTC" : "ETH";
  const points: string[] = [];

  if (s.balance === 0) {
    points.push(`⚠️ Zero balance detected — treasury appears empty or unfunded.`);
  } else if (s.reserveScore >= 80) {
    points.push(`✅ Reserve score ${s.reserveScore}/100 — strong liquidity position.`);
  } else if (s.reserveScore >= 50) {
    points.push(`🟡 Reserve score ${s.reserveScore}/100 — moderate buffer, monitor burn rate.`);
  } else {
    points.push(`🔴 Reserve score ${s.reserveScore}/100 — low reserves, action recommended.`);
  }

  if (s.monthlyBurn > 0) {
    points.push(`📉 Monthly burn: ${s.monthlyBurn.toFixed(4)} ${ticker} detected from on-chain outflows.`);
  } else {
    points.push(`📊 No outflows detected in 90-day window — dormant or incoming-only treasury.`);
  }

  if (s.runway !== null) {
    if (s.runway < 3) {
      points.push(`🚨 Runway only ${s.runway.toFixed(1)} months — automate expense payments immediately.`);
    } else if (s.runway < 12) {
      points.push(`⏱️ ${s.runway.toFixed(1)}-month runway — consider automating recurring payments.`);
    } else {
      points.push(`🏦 ${s.runway.toFixed(1)}-month runway — treasury well-positioned for automation.`);
    }
  } else {
    points.push(`♾️ Infinite runway — no spending detected, treasury fully preserved.`);
  }

  if (s.txCount > 0) {
    points.push(`🔗 ${s.txCount} transactions analyzed — Settlemint can automate recurring patterns.`);
  }

  return points;
}

export default router;
