'use client';
import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarClock, ArrowUpRight, Repeat, AlertTriangle, RefreshCw, Clock, CheckCircle2, Zap } from 'lucide-react';
import { walletApi, type RecurringPayment } from '@/lib/api';

const E: [number, number, number, number] = [0.16, 1, 0.3, 1];

function fmtUSD(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}
function fmtTokenAmt(n: number, sym: string) {
  return `${n.toFixed(4).replace(/\.?0+$/, '')} ${sym}`;
}
function shortAddr(a: string) {
  if (!a || a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const FREQ_DAYS: Record<string, number> = {
  daily: 1, weekly: 7, biweekly: 14, monthly: 30, irregular: 0,
};

interface PredictedPayment {
  id: string;
  dueDate: Date;
  toAddress: string;
  toLabel?: string;
  amount: number;
  amountUSD: number;
  token: string;
  frequency: string;
  confidence: number;
  usdAvailable: boolean;
  isOverdue: boolean;
  daysUntil: number;
}

function projectPayments(patterns: RecurringPayment[], horizonDays = 90): PredictedPayment[] {
  const now = Date.now();
  const horizon = now + horizonDays * 86400 * 1000;
  const result: PredictedPayment[] = [];

  for (const p of patterns) {
    if (p.frequency === 'irregular') continue;
    const stepMs = FREQ_DAYS[p.frequency] * 86400 * 1000;
    if (!stepMs) continue;

    // Start from nextExpected if provided, otherwise extrapolate from last occurrence
    let next = p.nextExpected ? new Date(p.nextExpected).getTime() : now;
    // If next is in the past, advance until future
    while (next < now - stepMs) next += stepMs;

    let idx = 0;
    while (next <= horizon && idx < 12) {
      const due = new Date(next);
      const daysUntil = Math.round((next - now) / 86400 / 1000);
      result.push({
        id: `${p.toAddress}-${next}`,
        dueDate: due,
        toAddress: p.toAddress,
        toLabel: p.toLabel,
        amount: p.amount,
        amountUSD: p.amountUSD,
        token: p.token,
        frequency: p.frequency,
        confidence: p.confidence,
        usdAvailable: p.usdAvailable ?? false,
        isOverdue: daysUntil < 0,
        daysUntil,
      });
      next += stepMs;
      idx++;
    }
  }

  return result.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

function groupByBucket(payments: PredictedPayment[]) {
  const overdue: PredictedPayment[] = [];
  const thisWeek: PredictedPayment[] = [];
  const thisMonth: PredictedPayment[] = [];
  const later: PredictedPayment[] = [];

  for (const p of payments) {
    if (p.isOverdue) overdue.push(p);
    else if (p.daysUntil <= 7) thisWeek.push(p);
    else if (p.daysUntil <= 30) thisMonth.push(p);
    else later.push(p);
  }
  return { overdue, thisWeek, thisMonth, later };
}

function PaymentCard({ p, onAutomate }: { p: PredictedPayment; onAutomate: (p: PredictedPayment) => void }) {
  const amtStr = p.usdAvailable && p.amountUSD > 0
    ? fmtUSD(p.amountUSD)
    : fmtTokenAmt(p.amount, p.token);

  const urgency = p.isOverdue ? 'overdue'
    : p.daysUntil <= 3 ? 'soon'
    : p.daysUntil <= 7 ? 'week'
    : 'later';

  const urgencyColor = urgency === 'overdue' ? '#ef4444'
    : urgency === 'soon' ? '#f59e0b'
    : urgency === 'week' ? '#F7931A'
    : 'var(--text-muted)';

  const dueLabelStyle = urgency === 'overdue'
    ? { background: 'rgba(239,68,68,0.10)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.22)' }
    : urgency === 'soon'
    ? { background: 'rgba(245,158,11,0.10)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.22)' }
    : urgency === 'week'
    ? { background: 'rgba(247,147,26,0.10)', color: '#F7931A', border: '1px solid rgba(247,147,26,0.22)' }
    : { background: 'var(--bg-raised)', color: 'var(--text-muted)', border: '1px solid var(--border-lo)' };

  const dueLabel = p.isOverdue
    ? `${Math.abs(p.daysUntil)}d overdue`
    : p.daysUntil === 0 ? 'Due today'
    : p.daysUntil === 1 ? 'Due tomorrow'
    : `In ${p.daysUntil}d`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: E }}
      className="flex items-center gap-4 rounded-2xl px-5 py-4"
      style={{ background: 'var(--bg-card)', border: `1px solid ${p.isOverdue ? 'rgba(239,68,68,0.18)' : 'var(--border-base)'}` }}>

      {/* Icon */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ background: `${urgencyColor}14`, border: `1px solid ${urgencyColor}28` }}>
        <Repeat className="h-4 w-4" style={{ color: urgencyColor }} />
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            {p.toLabel ?? shortAddr(p.toAddress)}
          </span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
            style={{ background: 'rgba(0,201,167,0.10)', color: '#00c9a7', border: '1px solid rgba(0,201,167,0.22)' }}>
            {p.frequency}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {Math.round(p.confidence * 100)}% confidence
          </span>
        </div>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {p.dueDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </p>
      </div>

      {/* Amount */}
      <div className="text-right shrink-0 mr-2">
        <p className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{amtStr}</p>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={dueLabelStyle}>
          {dueLabel}
        </span>
      </div>

      {/* Automate button */}
      <button onClick={() => onAutomate(p)}
        className="shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all"
        style={{ background: 'rgba(247,147,26,0.10)', color: '#F7931A', border: '1px solid rgba(247,147,26,0.22)' }}
        title="Set up automation for this payment">
        <Zap className="h-3 w-3" /> Automate
      </button>
    </motion.div>
  );
}

function Section({ title, accent, payments, onAutomate }: {
  title: string; accent: string; payments: PredictedPayment[];
  onAutomate: (p: PredictedPayment) => void;
}) {
  if (payments.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-px w-8 rounded-full" style={{ background: accent }} />
        <span className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: accent }}>
          {title}
        </span>
        <span className="rounded-full px-2 py-0.5 text-[10px]"
          style={{ background: 'var(--bg-raised)', color: 'var(--text-muted)' }}>
          {payments.length}
        </span>
      </div>
      {payments.map(p => (
        <PaymentCard key={p.id} p={p} onAutomate={onAutomate} />
      ))}
    </div>
  );
}

export default function PredictedPaymentsView() {
  const { address } = useAccount();
  const [patterns, setPatterns] = useState<RecurringPayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [horizon, setHorizon] = useState(90);
  const [automateTarget, setAutomateTarget] = useState<PredictedPayment | null>(null);

  const load = async (addr: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await walletApi.analyze(addr, 'evm', '90d');
      setPatterns(result.recurringPayments ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Analysis failed');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (address) load(address);
  }, [address]);

  if (!address) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Connect your wallet to see predicted payments</p>
      </div>
    );
  }

  const predicted = projectPayments(patterns, horizon);
  const { overdue, thisWeek, thisMonth, later } = groupByBucket(predicted);

  const totalUSD = predicted
    .filter(p => p.usdAvailable && p.amountUSD > 0)
    .reduce((s, p) => s + p.amountUSD, 0);

  const handleAutomate = (p: PredictedPayment) => setAutomateTarget(p);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.04em', fontSize: '1.6rem' }}>
            Predicted Payments
          </h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Auto-detected recurring patterns · projected forward
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[30, 60, 90].map(d => (
            <button key={d} onClick={() => setHorizon(d)}
              className="rounded-xl px-3 py-1.5 text-xs font-semibold transition-all"
              style={{
                background: horizon === d ? 'rgba(247,147,26,0.14)' : 'var(--bg-raised)',
                color: horizon === d ? '#F7931A' : 'var(--text-muted)',
                border: `1px solid ${horizon === d ? 'rgba(247,147,26,0.3)' : 'var(--border-lo)'}`,
              }}>
              {d}d
            </button>
          ))}
          <button onClick={() => load(address)} disabled={loading}
            className="rounded-xl px-3 py-1.5 text-xs transition-all disabled:opacity-40"
            style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-lo)', color: 'var(--text-secondary)' }}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-2.5 text-sm"
          style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171' }}>
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-5 py-16">
          <div style={{ position: 'relative', width: 240, height: 8, borderRadius: 999, overflow: 'hidden',
            background: 'rgba(247,147,26,0.10)' }}>
            <motion.div style={{ position: 'absolute', inset: 0, borderRadius: 999, width: '55%',
              background: 'linear-gradient(90deg, transparent, #F7931A 50%, transparent)' }}
              animate={{ x: ['-100%', '280%'] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: [0.4, 0, 0.6, 1] }} />
          </div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Detecting recurring patterns…</p>
        </motion.div>
      )}

      {!loading && patterns.length === 0 && !error && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <CalendarClock className="h-10 w-10" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>No recurring patterns detected yet</p>
          <p className="text-xs max-w-xs" style={{ color: 'var(--text-muted)' }}>
            Patterns appear after 2+ payments to the same address at a regular interval.
            Make sure your wallet has at least 90 days of activity.
          </p>
        </div>
      )}

      {!loading && predicted.length > 0 && (
        <AnimatePresence>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-7">
            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Predicted payments', value: String(predicted.length), sub: `next ${horizon} days` },
                { label: 'Total projected', value: totalUSD > 0 ? fmtUSD(totalUSD) : '—', sub: 'known-price only' },
                { label: 'Patterns found', value: String(patterns.filter(p => p.frequency !== 'irregular').length), sub: 'regular frequencies' },
              ].map(s => (
                <div key={s.label} className="rounded-xl px-4 py-3"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] mb-1" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
                  <p className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>{s.value}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{s.sub}</p>
                </div>
              ))}
            </div>

            <Section title="Overdue" accent="#ef4444" payments={overdue} onAutomate={handleAutomate} />
            <Section title="This week" accent="#F7931A" payments={thisWeek} onAutomate={handleAutomate} />
            <Section title="This month" accent="#f59e0b" payments={thisMonth} onAutomate={handleAutomate} />
            <Section title="Later" accent="var(--text-muted)" payments={later} onAutomate={handleAutomate} />
          </motion.div>
        </AnimatePresence>
      )}

      {/* Automate modal */}
      <AnimatePresence>
        {automateTarget && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              onClick={() => setAutomateTarget(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }} transition={{ duration: 0.22, ease: E }}
              className="fixed inset-x-4 bottom-8 z-50 mx-auto max-w-md rounded-3xl p-7"
              style={{ background: 'var(--bg-card)', border: '1px solid rgba(247,147,26,0.25)' }}>
              <div className="absolute inset-x-0 top-0 h-px rounded-t-3xl"
                style={{ background: 'linear-gradient(90deg, transparent, rgba(247,147,26,0.6), transparent)' }} />
              <div className="flex items-center gap-3 mb-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{ background: 'rgba(247,147,26,0.12)', border: '1px solid rgba(247,147,26,0.24)' }}>
                  <Zap className="h-5 w-5" style={{ color: '#F7931A' }} />
                </div>
                <div>
                  <p className="font-bold" style={{ color: 'var(--text-primary)' }}>Automate this payment</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Lock BTC → mint MUSD → schedule</p>
                </div>
              </div>
              <div className="rounded-xl p-4 mb-5 space-y-2"
                style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-lo)' }}>
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>Recipient</span>
                  <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {shortAddr(automateTarget.toAddress)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>Amount</span>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {automateTarget.usdAvailable && automateTarget.amountUSD > 0
                      ? fmtUSD(automateTarget.amountUSD)
                      : fmtTokenAmt(automateTarget.amount, automateTarget.token)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>Frequency</span>
                  <span className="font-semibold capitalize" style={{ color: '#00c9a7' }}>{automateTarget.frequency}</span>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setAutomateTarget(null)}
                  className="flex-1 rounded-xl py-3 text-sm font-semibold"
                  style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-lo)', color: 'var(--text-secondary)' }}>
                  Cancel
                </button>
                <a href="/" className="flex-1 rounded-xl py-3 text-sm font-semibold text-center flex items-center justify-center gap-2"
                  style={{ background: '#F7931A', color: '#000' }}>
                  <CheckCircle2 className="h-4 w-4" /> Set up in Vault
                </a>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
