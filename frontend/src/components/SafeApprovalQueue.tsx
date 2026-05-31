"use client";
import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, Clock, Zap, Wallet, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { walletApi, type WalletAnalysis } from "@/lib/api";

interface PredictedTx {
  id: string;
  toAddress: string;
  toLabel?: string;
  amountUSD: number;
  amountBTC: number;
  token: string;
  category: string;
  frequency: string;
  confidence: number;
  predictedDate: string;
  predictedTs: number;
  status: "pending" | "approved" | "rejected";
}

function shortAddr(a: string) {
  if (!a || a.length < 12) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

function fmtUSD(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}

const CATEGORY_COLORS: Record<string, string> = {
  payment: "#F7931A",
  subscription: "#00c9a7",
  yield: "#22c55e",
  swap: "#3b82f6",
  transfer: "#8b5cf6",
  gas: "#6b7280",
  unknown: "#6b6784",
};

export default function SafeApprovalQueue() {
  const { address } = useAccount();
  const [queue, setQueue] = useState<PredictedTx[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    walletApi.analyze(address, "evm", "90d")
      .then((analysis: WalletAnalysis) => {
        const predictions: PredictedTx[] = analysis.recurringPayments.map((r, i) => {
          const now = Date.now();
          // Project next occurrence based on frequency
          const intervalMs =
            r.frequency === "daily" ? 86400_000 :
            r.frequency === "weekly" ? 7 * 86400_000 :
            30 * 86400_000;
          const predictedTs = now + intervalMs * (0.5 + (i % 3) * 0.3);
          return {
            id: `pred-${i}`,
            toAddress: r.toAddress,
            toLabel: r.toLabel,
            amountUSD: r.amountUSD,
            amountBTC: r.amount,
            token: r.token,
            category: r.frequency === "monthly" ? "payment" : "subscription",
            frequency: r.frequency,
            confidence: r.confidence,
            predictedDate: new Date(predictedTs).toLocaleDateString("en-US", {
              month: "short", day: "numeric", year: "numeric",
            }),
            predictedTs,
            status: "pending",
          };
        });
        setQueue(predictions.sort((a, b) => a.predictedTs - b.predictedTs));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [address]);

  const approve = (id: string) =>
    setQueue(q => q.map(t => t.id === id ? { ...t, status: "approved" } : t));
  const reject = (id: string) =>
    setQueue(q => q.map(t => t.id === id ? { ...t, status: "rejected" } : t));

  const pending = queue.filter(t => t.status === "pending");
  const decided = queue.filter(t => t.status !== "pending");

  if (!address) return null;

  return (
    <div className="card-base" style={{ padding: 0, overflow: "hidden" }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-5"
        style={{ background: "transparent" }}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(247,147,26,0.1)", border: "1px solid rgba(247,147,26,0.2)" }}>
            <Clock size={14} style={{ color: "#F7931A" }} />
          </div>
          <div className="text-left">
            <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Safe Mode · Approval Queue
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {loading ? "Analyzing wallet patterns…" : `${pending.length} predicted payments need approval`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pending.length > 0 && (
            <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
              style={{ background: "rgba(247,147,26,0.15)", color: "#F7931A", border: "1px solid rgba(247,147,26,0.3)" }}>
              <AlertTriangle size={10} />
              {pending.length} pending
            </span>
          )}
          {expanded ? <ChevronUp size={14} style={{ color: "var(--text-muted)" }} /> : <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ borderTop: "1px solid var(--border-lo)", padding: "12px 20px 20px" }}>
              {loading && (
                <div className="space-y-2 py-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="skeleton h-14 rounded-xl w-full" />
                  ))}
                </div>
              )}

              {!loading && queue.length === 0 && (
                <div className="py-8 text-center">
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                    No recurring patterns detected in the last 90 days.
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    As you transact on Mezo, predicted payments will appear here.
                  </p>
                </div>
              )}

              {/* Pending approvals */}
              {pending.length > 0 && (
                <div className="space-y-2 mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
                    Awaiting Approval
                  </p>
                  <AnimatePresence>
                    {pending.map((tx) => {
                      const catColor = CATEGORY_COLORS[tx.category] ?? "#6b6784";
                      return (
                        <motion.div
                          key={tx.id}
                          layout
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 8, height: 0 }}
                          className="flex items-center gap-3 rounded-xl p-4"
                          style={{ background: "var(--bg-raised)", border: "1px solid var(--border-lo)" }}
                        >
                          {/* Category dot */}
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: catColor }} />

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono" style={{ color: "var(--text-tertiary)" }}>
                                {shortAddr(tx.toAddress)}
                              </span>
                              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold capitalize"
                                style={{ background: `${catColor}18`, color: catColor, border: `1px solid ${catColor}28` }}>
                                {tx.category}
                              </span>
                              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                                {tx.frequency}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <Clock size={10} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                                Predicted: {tx.predictedDate}
                              </span>
                              <span className="text-[10px] rounded px-1 py-0.5"
                                style={{ background: "var(--bg-card)", color: "var(--text-muted)" }}>
                                {Math.round(tx.confidence * 100)}% confidence
                              </span>
                            </div>
                          </div>

                          {/* Amount */}
                          <div className="text-right shrink-0">
                            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                              {tx.amountUSD > 0 ? fmtUSD(tx.amountUSD) : "—"}
                            </div>
                            {tx.amountBTC > 0 && (
                              <div className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                                {tx.amountBTC.toFixed(6)} {tx.token}
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => approve(tx.id)}
                              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                              style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)" }}
                            >
                              <CheckCircle2 size={11} />
                              Approve
                            </button>
                            <button
                              onClick={() => reject(tx.id)}
                              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors"
                              style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
                            >
                              <XCircle size={11} />
                            </button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}

              {/* Decided */}
              {decided.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
                    Decided
                  </p>
                  {decided.map((tx) => (
                    <div key={tx.id} className="flex items-center gap-3 rounded-xl px-4 py-2.5 opacity-60"
                      style={{ background: "var(--bg-raised)" }}>
                      {tx.status === "approved"
                        ? <CheckCircle2 size={13} style={{ color: "#22c55e", flexShrink: 0 }} />
                        : <XCircle size={13} style={{ color: "#ef4444", flexShrink: 0 }} />
                      }
                      <span className="text-xs font-mono flex-1" style={{ color: "var(--text-muted)" }}>
                        {shortAddr(tx.toAddress)}
                      </span>
                      <span className="text-xs font-semibold" style={{ color: tx.status === "approved" ? "#22c55e" : "#ef4444" }}>
                        {tx.status === "approved" ? "Approved" : "Rejected"}
                      </span>
                      {tx.amountUSD > 0 && (
                        <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                          {fmtUSD(tx.amountUSD)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
