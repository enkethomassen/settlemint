import { NextRequest, NextResponse } from "next/server";

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

function buildHeuristicInsights(s: TreasurySnapshot) {
  const ticker = s.type === "btc" ? "BTC" : "ETH";
  const points: string[] = [];

  if (s.balance === 0) {
    points.push("⚠️ Zero balance detected — treasury appears empty or unfunded.");
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
    points.push("📊 No outflows detected in 90-day window — dormant or incoming-only treasury.");
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
    points.push("♾️ Infinite runway — no spending detected, treasury fully preserved.");
  }

  if (s.txCount > 0) {
    points.push(`🔗 ${s.txCount} transactions analyzed — Settlemint can automate recurring patterns.`);
  }

  return points;
}

export async function POST(req: NextRequest) {
  const snapshot = await req.json() as TreasurySnapshot;

  if (!snapshot?.address) {
    return NextResponse.json({ error: "Treasury snapshot required" }, { status: 400 });
  }

  const openaiKey = process.env.OPENAI_API_KEY || "";

  if (!openaiKey) {
    const insights = buildHeuristicInsights(snapshot);
    return NextResponse.json({ insights, model: "heuristic", powered_by: "built-in" });
  }

  try {
    const ticker = snapshot.type === "btc" ? "BTC" : "ETH";
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
Balance: ${snapshot.balance.toFixed(6)} ${ticker}
Monthly Burn Rate: ${snapshot.monthlyBurn > 0 ? snapshot.monthlyBurn.toFixed(6) : "0"} ${ticker}
Runway: ${snapshot.runway ? `${snapshot.runway.toFixed(1)} months` : "Infinite (no outflows)"}
Total Transactions: ${snapshot.txCount}
Reserve Score: ${snapshot.reserveScore}/100
Recent Activity: ${snapshot.recentTxs.length} recent transactions analyzed`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
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
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`OpenAI ${response.status}`);

    const aiData = await response.json() as any;
    const content = JSON.parse(aiData.choices[0].message.content);
    return NextResponse.json({ ...content, model: "gpt-4o-mini", powered_by: "openai" });
  } catch {
    const insights = buildHeuristicInsights(snapshot);
    return NextResponse.json({ insights, model: "heuristic", powered_by: "built-in", fallback: true });
  }
}
