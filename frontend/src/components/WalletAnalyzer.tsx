"use client";
import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { walletApi } from "@/lib/api";

const E: [number, number, number, number] = [0.16, 1, 0.3, 1];
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// ── Detect address type ──────────────────────────────────────
function detectType(addr: string): "btc" | "evm" | null {
  const clean = addr.trim();
  if (/^(1|3)[a-zA-HJ-NP-Z0-9]{25,34}$/.test(clean) || /^bc1[a-zA-HJ-NP-Z0-9]{6,87}$/.test(clean)) return "btc";
  if (/^0x[a-fA-F0-9]{40}$/.test(clean)) return "evm";
  return null;
}

// ── BTC analysis — proxied through backend (avoids CORS) ─────
async function analyzeBTC(addr: string) {
  const res = await fetch(`${API}/api/treasury/btc/${addr.trim()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(err.error || `BTC lookup failed (${res.status})`);
  }
  const data = await res.json() as any;

  const balance = data.final_balance / 1e8;
  const txCount = data.n_tx;
  const txs = (data.txs || []) as any[];

  const now = Date.now() / 1000;
  const ninetyDays = 90 * 86400;
  let totalOut = 0;

  for (const tx of txs) {
    if (now - tx.time > ninetyDays) continue;
    for (const inp of tx.inputs || []) {
      if (inp.prev_out?.addr === addr.trim()) {
        totalOut += inp.prev_out.value;
      }
    }
  }

  const monthlyBurn = totalOut / 1e8 / 3;

  return {
    type: "btc" as const,
    address: addr.trim(),
    balance,
    txCount,
    monthlyBurn,
    runway: monthlyBurn > 0 ? balance / monthlyBurn : null,
    reserveScore: Math.min(100, Math.round(balance > 0 ? 100 : 0)),
    categories: [{ label: "BTC Transfers", amount: totalOut / 1e8, pct: 100 }],
    recentTxs: txs.slice(0, 5).map((tx: any) => ({
      fullHash: tx.hash ?? "",
      hash: tx.hash?.slice(0, 18) + "…",
      time: new Date(tx.time * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      value: (tx.result / 1e8).toFixed(6),
      direction: tx.result >= 0 ? "in" : "out",
    })),
  };
}

// ── EVM analysis — proxied through backend (no NOTOK) ────────
async function analyzeEVM(addr: string) {
  const [balRes, txRes] = await Promise.all([
    fetch(`${API}/api/treasury/evm/${addr.trim()}/balance`),
    fetch(`${API}/api/treasury/evm/${addr.trim()}/txlist`),
  ]);

  if (!balRes.ok) {
    const err = await balRes.json().catch(() => ({})) as any;
    throw new Error(err.error || `Balance lookup failed (${balRes.status})`);
  }

  const balData = await balRes.json() as any;
  const txData = await txRes.json() as any;

  // status "0" with result "0x0" means zero balance — not an error
  if (balData.status === "0" && balData.result !== "0") {
    throw new Error(balData.message || "Could not fetch EVM balance.");
  }

  const balance = parseFloat(balData.result || "0") / 1e18;
  // txData.result is an array on success, or "0x" / error string on fail
  const txs = Array.isArray(txData.result) ? txData.result : [];

  const cutoff = Math.floor(Date.now() / 1000) - 90 * 86400;
  let totalOut = 0;
  for (const tx of txs) {
    if (parseInt(tx.timeStamp) < cutoff) continue;
    if (tx.from?.toLowerCase() === addr.toLowerCase()) {
      totalOut += parseFloat(tx.value) / 1e18;
    }
  }

  const monthlyBurn = totalOut / 3;

  return {
    type: "evm" as const,
    address: addr.trim(),
    balance,
    txCount: txs.length,
    monthlyBurn,
    runway: monthlyBurn > 0 ? balance / monthlyBurn : null,
    reserveScore: balance > 0.1 ? 95 : balance > 0.01 ? 65 : 30,
    categories: [{ label: "ETH Transfers", amount: totalOut, pct: 100 }],
    recentTxs: txs.slice(0, 5).map((tx: any) => ({
      fullHash: tx.hash ?? "",
      hash: tx.hash?.slice(0, 18) + "…",
      time: new Date(parseInt(tx.timeStamp) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      value: (parseFloat(tx.value) / 1e18).toFixed(6),
      direction: tx.from?.toLowerCase() === addr.toLowerCase() ? "out" : "in",
    })),
  };
}

type AnalysisResult = Awaited<ReturnType<typeof analyzeBTC>> | Awaited<ReturnType<typeof analyzeEVM>>;

interface AIInsights {
  summary?: string;
  insights?: string[];
  risks?: string[];
  recommendation?: string;
  health?: "healthy" | "caution" | "critical";
  model?: string;
  powered_by?: string;
}

// ── AI agent call ────────────────────────────────────────────
async function fetchAIInsights(result: AnalysisResult): Promise<AIInsights> {
  const res = await fetch(`${API}/api/treasury/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result),
  });
  if (!res.ok) return {};
  return res.json();
}

const healthColors: Record<string, string> = {
  healthy: "#10d98c",
  caution: "#f59e0b",
  critical: "#ef4444",
};

export default function WalletAnalyzer() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [aiInsights, setAiInsights] = useState<AIInsights | null>(null);
  const [error, setError] = useState("");
  // tagging state: txHash → tag label
  const [tags, setTags] = useState<Record<string, string>>({});
  const [tagInput, setTagInput] = useState<Record<string, string>>({});
  const [tagOpen, setTagOpen] = useState<Record<string, boolean>>({});
  const [tagSaving, setTagSaving] = useState<Record<string, boolean>>({});
  const tagRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const analyze = async () => {
    const trimmed = address.trim();
    if (!trimmed) return;
    const type = detectType(trimmed);
    if (!type) {
      setError("Enter a valid Bitcoin (BTC) or Ethereum/EVM (0x…) address.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    setAiInsights(null);
    try {
      const res = type === "btc" ? await analyzeBTC(trimmed) : await analyzeEVM(trimmed);
      setResult(res);
      // Kick off AI analysis in parallel — non-blocking
      setAiLoading(true);
      fetchAIInsights(res)
        .then(ai => setAiInsights(ai))
        .catch(() => {})
        .finally(() => setAiLoading(false));
    } catch (e: any) {
      setError(e.message || "Analysis failed. Check the address and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") analyze(); };
  const reset = () => {
    setResult(null); setError(""); setAddress(""); setAiInsights(null);
    setTags({}); setTagInput({}); setTagOpen({}); setTagSaving({});
  };

  const openTag = (hash: string) => {
    setTagOpen(p => ({ ...p, [hash]: true }));
    setTimeout(() => tagRefs.current[hash]?.focus(), 50);
  };

  const closeTag = (hash: string) => {
    setTagOpen(p => ({ ...p, [hash]: false }));
  };

  const saveTag = async (hash: string) => {
    const label = (tagInput[hash] || '').trim();
    if (!label || !result) return;
    setTagSaving(p => ({ ...p, [hash]: true }));
    try {
      await walletApi.addTag(hash, result.address, label);
      setTags(p => ({ ...p, [hash]: label }));
      setTagOpen(p => ({ ...p, [hash]: false }));
    } catch {
      // silently ignore — tag saved locally anyway
      setTags(p => ({ ...p, [hash]: label }));
      setTagOpen(p => ({ ...p, [hash]: false }));
    } finally {
      setTagSaving(p => ({ ...p, [hash]: false }));
    }
  };

  const scoreColor = (score: number) => score >= 80 ? "var(--green)" : score >= 50 ? "var(--amber)" : "var(--accent)";

  return (
    <section id="analyze" style={{ paddingTop: "clamp(80px,10vw,130px)", paddingBottom: "clamp(80px,10vw,130px)" }}>
      <div className="mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-14">

        {/* Section header */}
        <div className="text-center mb-16 max-w-2xl mx-auto">
          <div className="flex items-center justify-center gap-3 mb-7">
            <span className="h-px w-10 rounded-full" style={{ background: "rgba(247,147,26,0.4)" }} />
            <span className="text-[11px] font-bold uppercase tracking-[0.26em]" style={{ color: "#F7931A" }}>
              Free · No signup required
            </span>
            <span className="h-px w-10 rounded-full" style={{ background: "rgba(247,147,26,0.4)" }} />
          </div>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "clamp(2.4rem,4.5vw,4.2rem)",
              letterSpacing: "-0.04em",
              lineHeight: 1.0,
              color: "var(--text-primary)",
              textWrap: "balance",
            }}
          >
            See inside your<br />
            <span className="gradient-btc">Bitcoin treasury.</span>
          </h2>
          <p style={{ marginTop: "1.5rem", fontSize: "1.1rem", lineHeight: 1.9, color: "var(--text-secondary)", maxWidth: "520px", margin: "1.5rem auto 0" }}>
            Paste any Bitcoin or EVM address. Real on-chain data. AI-powered cashflow insights — instantly.
          </p>
        </div>

        {/* Input */}
        <div className="max-w-2xl mx-auto">
          <div className="card-shell" style={{ padding: "6px" }}>
            <div className="card-core" style={{ padding: "6px 6px 6px 20px", display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                value={address}
                onChange={e => setAddress(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Paste any BTC or EVM (0x…) wallet address…"
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  fontSize: "14.5px", color: "var(--text-primary)", fontFamily: "var(--font-mono)",
                  padding: "12px 0",
                }}
              />
              <button
                onClick={analyze}
                disabled={loading || !address.trim()}
                className="btn-primary"
                style={{ padding: "11px 22px", fontSize: "14px", borderRadius: "calc(var(--r-2xl) - 10px)", flexShrink: 0 }}
              >
                {loading ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                ) : null}
                {loading ? "Analyzing…" : "Analyze →"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-5 mt-4" style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            {["Read-only · no signing required", "Proxied · no rate limits", "AI-powered insights"].map(h => (
              <div key={h} className="flex items-center gap-1.5">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                {h}
              </div>
            ))}
          </div>
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="max-w-2xl mx-auto mt-4 px-4 py-3 rounded-xl text-sm font-medium"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", color: "#ef4444" }}
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Result panel */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.6, ease: E }}
              className="max-w-2xl mx-auto mt-8"
            >
              {/* Header row */}
              <div className="flex items-center justify-between mb-4 px-2">
                <div className="flex items-center gap-3">
                  <span className="status-live" />
                  <span style={{ fontSize: "13px", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                    {result.address.slice(0, 8)}…{result.address.slice(-6)}
                  </span>
                  <span
                    className="chip"
                    style={{ background: result.type === "btc" ? "rgba(247,147,26,0.12)" : "rgba(59,130,246,0.12)", color: result.type === "btc" ? "var(--btc-bright)" : "#60a5fa", borderColor: result.type === "btc" ? "var(--btc-border)" : "rgba(59,130,246,0.24)", fontSize: "10px" }}
                  >
                    {result.type === "btc" ? "Bitcoin" : "EVM"}
                  </span>
                </div>
                <button onClick={reset} className="btn-ghost" style={{ fontSize: "12px", padding: "5px 12px" }}>
                  Scan different →
                </button>
              </div>

              {/* Stat grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: "Balance", value: `${result.balance.toFixed(4)}`, unit: result.type === "btc" ? "BTC" : "ETH", color: result.type === "btc" ? "var(--btc-bright)" : "#60a5fa" },
                  { label: "Monthly Burn", value: result.monthlyBurn > 0 ? result.monthlyBurn.toFixed(4) : "—", unit: result.type === "btc" ? "BTC" : "ETH", color: "var(--accent)" },
                  { label: "Runway", value: result.runway ? `${result.runway.toFixed(1)} mo` : "∞", unit: "", color: "var(--text-primary)" },
                  { label: "Reserve Score", value: `${result.reserveScore}`, unit: "/100", color: scoreColor(result.reserveScore) },
                ].map(s => (
                  <motion.div
                    key={s.label}
                    initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, ease: E }}
                    style={{ background: "var(--bg-card)", border: "1px solid var(--border-base)", borderRadius: "var(--r-xl)", padding: "18px 16px" }}
                  >
                    <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>{s.label}</p>
                    <p style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "1.25rem", color: s.color, letterSpacing: "-0.02em" }}>
                      {s.value}<span style={{ fontSize: "11px", marginLeft: 3, opacity: 0.6 }}>{s.unit}</span>
                    </p>
                  </motion.div>
                ))}
              </div>

              {/* AI Insights panel */}
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-base)", borderRadius: "var(--r-xl)", padding: "20px 22px", marginBottom: "12px" }}>
                <div className="flex items-center gap-2 mb-4">
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(168,85,247,0.14)", border: "1px solid rgba(168,85,247,0.28)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="2" strokeLinecap="round">
                      <path d="M12 2a10 10 0 0 1 10 10c0 4-2.5 7.4-6 9M12 2a10 10 0 0 0-10 10c0 4 2.5 7.4 6 9"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </div>
                  <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                    AI Agent Insights
                  </p>
                  {aiLoading && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="2" strokeLinecap="round" style={{ animation: "spin 1s linear infinite", marginLeft: "auto" }}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                  )}
                  {aiInsights?.health && (
                    <span style={{ marginLeft: "auto", fontSize: "10px", fontWeight: 600, padding: "2px 10px", borderRadius: 20, background: `${healthColors[aiInsights.health] || "#888"}18`, color: healthColors[aiInsights.health] || "#888", border: `1px solid ${healthColors[aiInsights.health] || "#888"}30`, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      {aiInsights.health}
                    </span>
                  )}
                </div>

                {aiLoading && !aiInsights && (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="animate-pulse h-4 rounded" style={{ background: "var(--bg-raised)", width: `${75 + i * 5}%` }} />
                    ))}
                  </div>
                )}

                {aiInsights && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: E }}>
                    {aiInsights.summary && (
                      <p style={{ fontSize: "13.5px", color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 14 }}>
                        {aiInsights.summary}
                      </p>
                    )}

                    {/* Show array insights (OpenAI) or string array (heuristic) */}
                    {Array.isArray(aiInsights.insights) && aiInsights.insights.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {(aiInsights.insights as string[]).map((insight: string, i: number) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.08, ease: E }}
                            style={{ fontSize: "13px", color: "var(--text-secondary)", padding: "6px 0", borderBottom: i < (aiInsights.insights as string[]).length - 1 ? "1px solid var(--border-void)" : "none" }}
                          >
                            {insight}
                          </motion.div>
                        ))}
                      </div>
                    )}

                    {aiInsights.risks && aiInsights.risks.length > 0 && (
                      <div className="mt-3">
                        <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Risks</p>
                        {aiInsights.risks.map((risk: string, i: number) => (
                          <div key={i} style={{ fontSize: "12.5px", color: "#f59e0b", padding: "4px 0" }}>⚠️ {risk}</div>
                        ))}
                      </div>
                    )}

                    {aiInsights.recommendation && (
                      <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: "var(--r-lg)", background: "rgba(247,147,26,0.06)", border: "1px solid rgba(247,147,26,0.15)" }}>
                        <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#F7931A", marginBottom: 5 }}>Bitstream Recommendation</p>
                        <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6 }}>🚀 {aiInsights.recommendation}</p>
                      </div>
                    )}

                    <p style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: 12 }}>
                      Powered by {aiInsights.powered_by === "openai" ? "GPT-4o Mini" : "built-in heuristics"}
                    </p>
                  </motion.div>
                )}
              </div>

              {/* Cashflow bar */}
              {result.categories.length > 0 && (
                <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-base)", borderRadius: "var(--r-xl)", padding: "20px 22px", marginBottom: "12px" }}>
                  <div className="flex items-center justify-between mb-4">
                    <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Spend by category</p>
                    <p style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                      {result.categories.reduce((a, c) => a + c.amount, 0).toFixed(4)} {result.type === "btc" ? "BTC" : "ETH"} total
                    </p>
                  </div>
                  {result.categories.map(cat => (
                    <div key={cat.label} className="mb-3">
                      <div className="flex justify-between mb-1.5">
                        <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{cat.label}</span>
                        <span style={{ fontSize: "13px", fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{cat.amount.toFixed(4)}</span>
                      </div>
                      <div style={{ height: 5, background: "var(--bg-raised)", borderRadius: 4, overflow: "hidden" }}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${cat.pct}%` }}
                          transition={{ duration: 1, ease: E }}
                          style={{ height: "100%", borderRadius: 4, background: "linear-gradient(90deg, var(--green), #16a34a)" }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Recent activity */}
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-base)", borderRadius: "var(--r-xl)", padding: "20px 22px" }}>
                <div className="flex items-center justify-between mb-4">
                  <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Recent activity</p>
                  <p style={{ fontSize: "10px", color: "var(--text-muted)" }}>Click 🏷 to tag</p>
                </div>
                {result.recentTxs.length === 0 ? (
                  <p style={{ fontSize: "13px", color: "var(--text-muted)", padding: "8px 0" }}>No recent transactions.</p>
                ) : (
                  <div>
                    {result.recentTxs.map((tx: any, i: number) => {
                      const fh = tx.fullHash || tx.hash;
                      const savedTag = tags[fh];
                      const isOpen = tagOpen[fh];
                      const isSaving = tagSaving[fh];
                      return (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.06, ease: E }}
                          style={{ padding: "13px 0", borderBottom: i < result.recentTxs.length - 1 ? "1px solid var(--border-void)" : "none" }}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: tx.direction === "in" ? "rgba(34,197,94,0.12)" : "rgba(247,147,26,0.10)" }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={tx.direction === "in" ? "var(--green)" : "var(--accent)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  {tx.direction === "in"
                                    ? <><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></>
                                    : <><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>}
                                </svg>
                              </div>
                              <div>
                                <p style={{ fontSize: "13px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>{tx.hash}</p>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                                  <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>{tx.time}</p>
                                  {savedTag && (
                                    <span style={{ fontSize: "10px", padding: "1px 7px", borderRadius: 10, background: "rgba(247,147,26,0.10)", color: "#F7931A", border: "1px solid rgba(247,147,26,0.22)", fontWeight: 600 }}>
                                      {savedTag}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: "13px", fontFamily: "var(--font-mono)", fontWeight: 600, color: tx.direction === "in" ? "var(--green)" : "var(--text-primary)" }}>
                                {tx.direction === "in" ? "+" : "-"}{tx.value} {result.type === "btc" ? "BTC" : "ETH"}
                              </span>
                              <button
                                onClick={() => isOpen ? closeTag(fh) : openTag(fh)}
                                style={{ fontSize: "14px", background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px", borderRadius: 6, lineHeight: 1, opacity: 0.7 }}
                                title={savedTag ? "Edit tag" : "Add tag"}
                              >
                                🏷
                              </button>
                            </div>
                          </div>
                          <AnimatePresence>
                            {isOpen && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}
                                style={{ overflow: "hidden" }}
                              >
                                <div style={{ display: "flex", gap: 6, marginTop: 8, paddingLeft: 38 }}>
                                  <input
                                    ref={el => { tagRefs.current[fh] = el; }}
                                    value={tagInput[fh] || ""}
                                    onChange={e => setTagInput(p => ({ ...p, [fh]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === "Enter") saveTag(fh); if (e.key === "Escape") closeTag(fh); }}
                                    placeholder="e.g. payroll, subscription, gas…"
                                    style={{ flex: 1, background: "var(--bg-raised)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8, padding: "6px 10px", fontSize: "12px", color: "var(--text-primary)", outline: "none", fontFamily: "var(--font-mono)" }}
                                  />
                                  <button
                                    onClick={() => saveTag(fh)}
                                    disabled={isSaving || !(tagInput[fh] || "").trim()}
                                    style={{ padding: "6px 14px", fontSize: "12px", background: "#F7931A", color: "#0a0a0a", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", opacity: isSaving ? 0.6 : 1 }}
                                  >
                                    {isSaving ? "…" : "Save"}
                                  </button>
                                  <button onClick={() => closeTag(fh)}
                                    style={{ padding: "6px 10px", fontSize: "12px", background: "transparent", color: "var(--text-muted)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, cursor: "pointer" }}>
                                    ✕
                                  </button>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>

              <p style={{ textAlign: "center", fontSize: "11px", color: "var(--text-muted)", marginTop: 16 }}>
                Read-only · no signing required · data proxied via Bitstream backend
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {!result && !loading && !error && (
          <p style={{ textAlign: "center", fontSize: "12.5px", color: "var(--text-muted)", marginTop: 20 }}>
            No login required · read-only · paste any Bitcoin or EVM address
          </p>
        )}
      </div>

      <style jsx global>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </section>
  );
}
