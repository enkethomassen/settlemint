"use client";
import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Prices {
  btc: number;
  musd: number;
  timestamp: number;
}

export default function PriceTicker() {
  const [prices, setPrices] = useState<Prices | null>(null);
  const [prev, setPrev] = useState<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  const fetchPrices = () => {
    fetch("/api/prices")
      .then(r => r.json())
      .then((d: Prices) => {
        setPrev(prices?.btc ?? null);
        setPrices(d);
        if (prices?.btc) {
          setFlash(d.btc > prices.btc ? "up" : d.btc < prices.btc ? "down" : null);
          setTimeout(() => setFlash(null), 1200);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchPrices();
    const id = setInterval(fetchPrices, 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!prices) return null;

  const change = prev ? ((prices.btc - prev) / prev) * 100 : 0;
  const Icon = change > 0 ? TrendingUp : change < 0 ? TrendingDown : Minus;
  const color = change > 0 ? "#22c55e" : change < 0 ? "#ef4444" : "var(--text-muted)";

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {/* BTC */}
      <motion.div
        className="flex items-center gap-2 rounded-xl px-3 py-1.5"
        style={{
          background: flash === "up" ? "rgba(34,197,94,0.08)" : flash === "down" ? "rgba(239,68,68,0.08)" : "var(--bg-raised)",
          border: "1px solid var(--border-lo)",
          transition: "background 0.3s",
        }}
      >
        <span className="text-xs font-bold" style={{ color: "var(--btc)" }}>₿</span>
        <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
          ${prices.btc.toLocaleString("en-US", { maximumFractionDigits: 0 })}
        </span>
        {change !== 0 && (
          <span className="flex items-center gap-0.5 text-[11px] font-medium" style={{ color }}>
            <Icon size={10} />
            {Math.abs(change).toFixed(2)}%
          </span>
        )}
      </motion.div>

      {/* MUSD */}
      <div className="flex items-center gap-2 rounded-xl px-3 py-1.5"
        style={{ background: "var(--bg-raised)", border: "1px solid var(--border-lo)" }}>
        <span className="text-xs font-bold" style={{ color: "var(--accent)" }}>M</span>
        <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
          MUSD $1.00
        </span>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>
          pegged
        </span>
      </div>

      <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
        Live · Mezo
      </div>
    </div>
  );
}
