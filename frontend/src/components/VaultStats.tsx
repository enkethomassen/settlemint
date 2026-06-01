"use client";
import { Bitcoin, DollarSign, Shield, Layers, TrendingUp, Wallet, AlertTriangle, RefreshCw } from "lucide-react";
import { useVault } from "@/hooks/useVault";
import { useAccount } from "wagmi";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

function fmt(val: string | number): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtUSD(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

// Fetch live BTC price from our Next.js API route
function useLivePrice() {
  const [btcPrice, setBtcPrice] = useState(73743);
  useEffect(() => {
    fetch("/api/prices")
      .then(r => r.json())
      .then(d => { if (d.btc) setBtcPrice(d.btc); })
      .catch(() => {});
    // Refresh every 60s
    const id = setInterval(() => {
      fetch("/api/prices")
        .then(r => r.json())
        .then(d => { if (d.btc) setBtcPrice(d.btc); })
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  return btcPrice;
}

// Fetch real Mezo wallet balance for the connected address
function useMezoWallet(address: string | undefined) {
  const [balance, setBalance] = useState<number | null>(null);
  const [txCount, setTxCount] = useState<number | null>(null);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/treasury/evm/${address}/balance`)
      .then(r => r.json())
      .then(d => {
        const raw = d.result ?? "0";
        const wei = raw.startsWith("0x") ? parseInt(raw, 16) : parseFloat(raw);
        setBalance(wei / 1e18);
      })
      .catch(() => {});

    // Also get tx count from transactions endpoint
    fetch(`/api/treasury/evm/${address}/txlist`)
      .then(r => r.json())
      .then(d => { setTxCount(Array.isArray(d.result) ? d.result.length : 0); })
      .catch(() => {});
  }, [address]);

  return { balance, txCount };
}

export default function VaultStats() {
  const { collateral, musdBalance, collateralRatio, payments, isLoading, isError, errorMessage, refetch } = useVault();
  const { address } = useAccount();
  const btcPrice = useLivePrice();
  const { balance: mezoBalance, txCount } = useMezoWallet(address);

  const ratio =
    collateralRatio === 0n ? 0
    : collateralRatio >= BigInt("999999999999999") ? Infinity
    : Number(collateralRatio);

  const ratioStatus = ratio === 0 ? "empty" : ratio < 150 ? "danger" : ratio < 200 ? "warn" : "ok";
  const ratioLabel = ratio === 0 ? "—" : ratio === Infinity ? "∞" : `${ratio}%`;
  const ratioColor = ratioStatus === "danger" ? "#dc2626" : ratioStatus === "warn" ? "#d97706" : ratioStatus === "ok" ? "#16a34a" : "var(--text-muted)";

  const activePayments = payments.filter(p => p.isActive).length;

  // Use real Mezo balance if available, otherwise vault collateral
  const displayBalance = mezoBalance ?? parseFloat(collateral);
  const btcUSD = displayBalance * btcPrice;

  const stats = [
    {
      label: "Mezo BTC Balance",
      value: isLoading && mezoBalance === null ? null : displayBalance.toFixed(6),
      unit: "BTC",
      sub: `≈ ${fmtUSD(btcUSD)}  ·  $${fmt(btcPrice)}/BTC`,
      icon: Bitcoin,
      iconColor: "var(--btc)",
      iconBg: "var(--btc-bg)",
      iconBorder: "var(--btc-border)",
      valueColor: "var(--btc)",
      borderAccent: "var(--btc-border)",
      error: false,
    },
    {
      label: "Available MUSD",
      value: isLoading ? null : fmt(musdBalance),
      unit: "MUSD",
      sub: "Stablecoin liquidity · 1:1 USD",
      icon: DollarSign,
      iconColor: "var(--accent)",
      iconBg: "var(--accent-soft)",
      iconBorder: "var(--accent-border)",
      valueColor: "var(--text-primary)",
      borderAccent: "transparent",
      // Bug 3: surface a real reason + retry instead of a meaningless 0.00.
      error: isError,
    },
    {
      label: "Collateral Health",
      value: isLoading ? null : ratioLabel,
      unit: "",
      sub: ratio === 0 ? "No vault — demo mode" : "Min 150% required",
      icon: Shield,
      iconColor: ratio === 0 ? "var(--text-muted)" : ratioColor,
      iconBg: ratioStatus === "danger" ? "var(--danger-bg)" : ratioStatus === "ok" ? "rgba(22,163,74,0.08)" : "var(--bg-raised)",
      iconBorder: ratioStatus === "danger" ? "var(--danger-border)" : ratioStatus === "ok" ? "rgba(22,163,74,0.2)" : "var(--border)",
      valueColor: ratio === 0 ? "var(--text-muted)" : ratioColor,
      borderAccent: "transparent",
      error: false,
    },
    {
      label: "On-Chain Activity",
      value: txCount !== null ? String(txCount) : isLoading ? null : String(activePayments),
      unit: "",
      sub: txCount !== null ? "Mezo txs fetched live" : `${activePayments} active schedules`,
      icon: txCount !== null ? TrendingUp : Layers,
      iconColor: "var(--text-secondary)",
      iconBg: "var(--bg-raised)",
      iconBorder: "var(--border)",
      valueColor: "var(--text-primary)",
      borderAccent: "transparent",
      error: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 }}
          className="card"
          style={{ borderColor: stat.borderAccent !== "transparent" ? stat.borderAccent : undefined }}
        >
          <div className="flex items-center justify-between mb-4">
            <span className="field-label" style={{ letterSpacing: "0.06em" }}>{stat.label}</span>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: stat.iconBg, border: `1px solid ${stat.iconBorder}` }}>
              <stat.icon size={13} style={{ color: stat.iconColor }} />
            </div>
          </div>

          {stat.error ? (
            <div className="mt-1">
              <div className="flex items-center gap-1.5">
                <AlertTriangle size={13} style={{ color: "var(--amber, #d97706)" }} />
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {errorMessage || "Mezo RPC unavailable"}
                </p>
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                Couldn’t read your MUSD balance from Mezo.
              </p>
              <button
                onClick={() => refetch()}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
                style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              >
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          ) : (isLoading && stat.value === null) ? (
            <div className="space-y-2 mt-1">
              <div className="skeleton h-7 w-20" />
              <div className="skeleton h-3 w-14" />
            </div>
          ) : (
            <>
              <p className="stat-number" style={{ color: stat.valueColor }}>
                {stat.value}
                {stat.unit && (
                  <span className="text-sm font-medium ml-1.5" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
                    {stat.unit}
                  </span>
                )}
              </p>
              <p className="text-xs mt-2 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {stat.sub}
              </p>
            </>
          )}
        </motion.div>
      ))}
    </div>
  );
}
