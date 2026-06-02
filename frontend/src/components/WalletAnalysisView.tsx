'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw, Tag, Eye, EyeOff, ArrowDownLeft, ArrowUpRight,
  Copy, Check, ExternalLink, AlertTriangle, Repeat, TrendingDown,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import {
  walletApi,
  type TransactionCategory,
  type WalletAnalysis,
  type WalletTransaction,
} from '@/lib/api';

const E: [number, number, number, number] = [0.16, 1, 0.3, 1];
const EXPLORER = 'https://explorer.mezo.org';

type RangeOption = '30d' | '90d' | '180d';

const CATEGORY_COLORS: Record<string, string> = {
  payment:      '#F7931A',
  subscription: '#00c9a7',
  yield:        '#22c55e',
  transfer:     '#3b82f6',
  stablecoin:   '#a78bfa',
  swap:         '#f59e0b',
  nft:          '#ec4899',
  unknown:      '#6b6784',
};

const TAG_PRESETS: Array<{ label: string; category: TransactionCategory }> = [
  { label: 'Salary',         category: 'payment' },
  { label: 'Payroll',        category: 'payment' },
  { label: 'Invoice',        category: 'payment' },
  { label: 'Bill',           category: 'payment' },
  { label: 'Rent',           category: 'payment' },
  { label: 'Tax',            category: 'payment' },
  { label: 'Vendor',         category: 'payment' },
  { label: 'Infrastructure', category: 'payment' },
  { label: 'x402 API',       category: 'subscription' },
  { label: 'Subscription',   category: 'subscription' },
  { label: 'Software',       category: 'subscription' },
  { label: 'SaaS',           category: 'subscription' },
  { label: 'Grant',          category: 'transfer' },
  { label: 'Hackathon',      category: 'transfer' },
  { label: 'Investment',     category: 'transfer' },
  { label: 'Reward',         category: 'transfer' },
  { label: 'Yield',          category: 'yield' },
  { label: 'Swap',           category: 'swap' },
];

function shortAddr(a: string) {
  if (!a || a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function fmtUSD(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}
function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}
function fmtTokenAmt(amount: number, symbol: string) {
  const abs = Math.abs(amount);
  const decimals = abs >= 1 ? 4 : abs >= 0.0001 ? 6 : 8;
  const s = amount.toFixed(decimals).replace(/\.?0+$/, '');
  return `${s || '0'} ${symbol}`;
}

// ── Orange Pill Loader ────────────────────────────────────────
const LOAD_STEPS = [
  'Fetching Mezo transactions…',
  'Resolving token prices…',
  'Analyzing spend patterns…',
  'Detecting recurring payments…',
  'Computing cashflow metrics…',
];
function PillLoader() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep(s => (s + 1) % LOAD_STEPS.length), 1300);
    return () => clearInterval(id);
  }, []);
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-6 py-20">
      <div style={{ position: 'relative', width: 260, height: 10, borderRadius: 999, overflow: 'hidden',
        background: 'rgba(247,147,26,0.10)', boxShadow: '0 0 20px rgba(247,147,26,0.12)' }}>
        <motion.div style={{
          position: 'absolute', inset: 0, borderRadius: 999,
          background: 'linear-gradient(90deg, transparent, #F7931A 50%, transparent)',
          width: '60%',
        }}
          animate={{ x: ['-100%', '280%'] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: [0.4, 0, 0.6, 1] }} />
      </div>
      <AnimatePresence mode="wait">
        <motion.p key={step}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          {LOAD_STEPS[step]}
        </motion.p>
      </AnimatePresence>
      <div className="flex items-center gap-2.5">
        {[0, 1, 2].map(i => (
          <motion.div key={i} style={{ width: 36, height: 7, borderRadius: 999, background: '#F7931A' }}
            animate={{ opacity: [0.2, 1, 0.2], scaleX: [0.7, 1, 0.7] }}
            transition={{ duration: 1.2, delay: i * 0.18, repeat: Infinity, ease: 'easeInOut' }} />
        ))}
      </div>
    </motion.div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      className="opacity-60 hover:opacity-100 transition-opacity" title="Copy" style={{ color: 'var(--text-muted)' }}>
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ── Tag Popover ──────────────────────────────────────────────
function TagPopover({ tx, walletAddress, existingTag, onTagged }: {
  tx: WalletTransaction; walletAddress: string; existingTag?: string; onTagged: (tag: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(existingTag ?? tx.predictedTag ?? '');
  const [category, setCategory] = useState<TransactionCategory>(
    tx.category === 'unknown' ? 'payment' : tx.category as TransactionCategory,
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!val.trim()) return;
    setSaving(true);
    try {
      await walletApi.addTag(tx.hash, walletAddress, val.trim(), category);
      onTagged(val.trim());
      setOpen(false);
    } catch { /* ignore */ }
    setSaving(false);
  };

  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors"
        style={{
          background: existingTag ? 'rgba(247,147,26,0.12)' : 'var(--bg-raised)',
          color: existingTag ? '#F7931A' : 'var(--text-muted)',
          border: `1px solid ${existingTag ? 'rgba(247,147,26,0.28)' : 'var(--border-lo)'}`,
        }}>
        <Tag className="h-3 w-3" />
        <span className="max-w-[72px] truncate">{existingTag ?? (tx.predictedTag ? `AI: ${tx.predictedTag}` : 'Tag')}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-9 z-50 rounded-xl p-3 shadow-2xl w-60"
            style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-hi)' }}>
            {tx.predictedTag && (
              <button onClick={() => setVal(tx.predictedTag!)}
                className="mb-2 w-full text-left text-xs px-2 py-1.5 rounded-lg"
                style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
                AI suggestion: <span style={{ color: '#F7931A' }}>{tx.predictedTag}</span>
              </button>
            )}
            <input value={val} onChange={e => setVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()}
              placeholder="Label this transaction…"
              className="w-full rounded-lg px-3 py-2 text-xs outline-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TAG_PRESETS.map(p => (
                <button key={p.label} type="button"
                  onClick={() => { setVal(p.label); setCategory(p.category); }}
                  className="rounded-full px-2 py-1 text-[10px] font-semibold"
                  style={{
                    background: val === p.label ? 'rgba(247,147,26,0.14)' : 'var(--bg-card)',
                    border: `1px solid ${val === p.label ? 'rgba(247,147,26,0.28)' : 'var(--border-lo)'}`,
                    color: val === p.label ? '#F7931A' : 'var(--text-muted)',
                  }}>
                  {p.label}
                </button>
              ))}
            </div>
            <select value={category} onChange={e => setCategory(e.target.value as TransactionCategory)}
              className="mt-2 w-full rounded-lg px-3 py-2 text-xs outline-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-base)', color: 'var(--text-secondary)' }}>
              {Object.keys(CATEGORY_COLORS).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button onClick={save} disabled={saving || !val.trim()}
              className="mt-2 w-full rounded-lg py-1.5 text-xs font-semibold transition-opacity disabled:opacity-40"
              style={{ background: '#F7931A', color: '#000' }}>
              {saving ? 'Saving…' : 'Save Tag'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Transaction Row ──────────────────────────────────────────
function TxRow({ tx, walletAddress, tag, onTagged }: {
  tx: WalletTransaction; walletAddress: string; tag?: string; onTagged: (hash: string, tag: string) => void;
}) {
  const color = CATEGORY_COLORS[tx.category] ?? '#6b6784';
  const dir = tx.direction ?? (tx.from?.toLowerCase() === walletAddress.toLowerCase() ? 'outgoing' : 'incoming');
  const isIn = dir === 'incoming';
  const sign = isIn ? '+' : dir === 'outgoing' ? '−' : '';
  const dirColor = isIn ? '#22c55e' : 'var(--text-primary)';
  const counterparty = tx.counterparty ?? (isIn ? tx.from : tx.to);
  const tokenLine = tx.displayValue ?? (tx.amount > 0 ? fmtTokenAmt(tx.amount, tx.tokenSymbol ?? tx.token) : null);
  const usdLine = tx.usdAvailable === false
    ? 'USD unavailable'
    : tx.displayUsd ?? (tx.amountUSD > 0 ? fmtUSD(tx.amountUSD) : tx.kind === 'contract_call' ? 'contract call' : 'USD unavailable');

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors hover:bg-white/[0.02]"
      style={{ borderBottom: '1px solid var(--border-void)' }}>
      <div className="flex h-7 w-7 items-center justify-center rounded-full shrink-0"
        style={{ background: isIn ? 'rgba(34,197,94,0.12)' : 'rgba(247,147,26,0.10)' }}>
        {isIn
          ? <ArrowDownLeft className="h-3.5 w-3.5" style={{ color: '#22c55e' }} />
          : <ArrowUpRight className="h-3.5 w-3.5" style={{ color: '#F7931A' }} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <a href={`${EXPLORER}/tx/${tx.hash}`} target="_blank" rel="noreferrer"
            className="font-mono text-xs flex items-center gap-1 hover:underline" style={{ color: 'var(--text-tertiary)' }}>
            {shortAddr(tx.hash)}<ExternalLink className="h-2.5 w-2.5 opacity-60" />
          </a>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
            style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}>
            {tag ?? tx.category}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>{isIn ? 'from' : 'to'} {shortAddr(counterparty ?? '')}</span>
          {counterparty && <CopyButton value={counterparty} />}
          <span>· {fmtDate(tx.timestamp)}</span>
        </div>
      </div>
      <div className="text-right shrink-0 mr-2">
        <div className="text-sm font-semibold font-mono" style={{ color: dirColor }}>
          {tokenLine ? `${sign}${tokenLine}` : <span style={{ color: 'var(--text-muted)' }}>—</span>}
        </div>
        <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{usdLine}</div>
      </div>
      <TagPopover tx={tx} walletAddress={walletAddress} existingTag={tag} onTagged={(t) => onTagged(tx.hash, t)} />
    </div>
  );
}

// ── Category Bar ─────────────────────────────────────────────
function CategoryBar({ category, amountUSD, percentage }: { category: string; amountUSD: number; percentage: number }) {
  const color = CATEGORY_COLORS[category] ?? '#6b6784';
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 text-xs capitalize shrink-0" style={{ color: 'var(--text-secondary)' }}>{category}</span>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-raised)' }}>
        <motion.div className="h-full rounded-full" style={{ background: color }}
          initial={{ width: 0 }} animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, ease: E }} />
      </div>
      <span className="w-16 text-right text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{fmtUSD(amountUSD)}</span>
      <span className="w-8 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{percentage}%</span>
    </div>
  );
}

// ── Spend Chart ──────────────────────────────────────────────
function SpendChart({ transactions }: { transactions: WalletTransaction[] }) {
  const buckets: Record<string, number> = {};
  for (const tx of transactions.filter(t => !t.isFiltered && t.category !== 'swap' && t.amountUSD > 0)) {
    const d = new Date(tx.timestamp * 1000);
    const key = `${d.getMonth() + 1}/${d.getDate()}`;
    buckets[key] = (buckets[key] ?? 0) + tx.amountUSD;
  }
  const data = Object.entries(buckets)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([date, usd]) => ({ date, usd: Math.round(usd * 100) / 100 }));

  if (data.length === 0) return (
    <div className="flex items-center justify-center h-32 text-sm" style={{ color: 'var(--text-muted)' }}>
      No USD-priced spend in this range
    </div>
  );
  return (
    <ResponsiveContainer width="100%" height={150}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: 'var(--bg-raised)', border: '1px solid var(--border-base)', borderRadius: 10, fontSize: 12 }}
          formatter={((v: unknown) => [fmtUSD(Number(v ?? 0)), 'Spend']) as any} />
        <Bar dataKey="usd" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill="#F7931A" fillOpacity={0.65 + (i / data.length) * 0.35} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Main View ────────────────────────────────────────────────
export default function WalletAnalysisView() {
  const { address: connectedAddress } = useAccount();
  const [range, setRange] = useState<RangeOption>('90d');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<WalletAnalysis | null>(null);
  const [showFiltered, setShowFiltered] = useState(false);
  const [userTags, setUserTags] = useState<Record<string, string>>({});

  const run = useCallback(async (addr: string, r: RangeOption) => {
    if (!addr) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const result = await walletApi.analyze(addr, 'evm', r);
      setAnalysis(result);
      const tagRes = await walletApi.getTags(addr).catch(() => ({ tags: [] }));
      const tagMap: Record<string, string> = {};
      for (const t of tagRes.tags) tagMap[t.txHash] = t.userTag;
      setUserTags(tagMap);
    } catch (e: any) {
      setError(e.message ?? 'Analysis failed');
    }
    setLoading(false);
  }, []);

  // Auto-run when wallet connects or range changes
  useEffect(() => {
    if (connectedAddress) run(connectedAddress, range);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAddress, range]);

  const handleTag = useCallback((hash: string, tag: string) => {
    setUserTags(prev => ({ ...prev, [hash]: tag }));
  }, []);

  const visibleTxs = analysis
    ? (showFiltered ? analysis.transactions : analysis.transactions.filter(t => !t.isFiltered))
    : [];
  const filteredCount = analysis ? analysis.transactions.filter(t => t.isFiltered).length : 0;

  // Monthly burn display
  const tokenBurn = analysis?.monthlyBurnTokens ?? {};
  const tokenBurnEntries = Object.entries(tokenBurn).filter(([, v]) => v > 0);
  let burnValue = '$0.00';
  let burnSub = 'avg outflow/month';
  if (analysis) {
    if (analysis.monthlyBurn > 0) {
      burnValue = fmtUSD(analysis.monthlyBurn);
      if (tokenBurnEntries.length > 0)
        burnSub = `+ ${tokenBurnEntries.map(([s, v]) => fmtTokenAmt(v, s)).join(', ')}/mo`;
    } else if (tokenBurnEntries.length > 0) {
      const [sym, amt] = tokenBurnEntries.sort((a, b) => b[1] - a[1])[0];
      burnValue = fmtTokenAmt(amt, sym);
      burnSub = 'avg/month · USD unavailable';
    }
  }

  if (!connectedAddress) {
    return (
      <div className="flex items-center justify-center h-64 text-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Connect your wallet to view analysis</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.04em', fontSize: '1.6rem' }}>
            Wallet Analysis
          </h2>
          <p className="mt-1 text-sm font-mono" style={{ color: 'var(--text-muted)' }}>
            {shortAddr(connectedAddress)} · Mezo Network
          </p>
        </div>

        {/* Range + refresh controls */}
        <div className="flex items-center gap-2">
          {(['30d', '90d', '180d'] as RangeOption[]).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className="rounded-xl px-3 py-1.5 text-xs font-semibold transition-all"
              style={{
                background: range === r ? 'rgba(247,147,26,0.14)' : 'var(--bg-raised)',
                color: range === r ? '#F7931A' : 'var(--text-muted)',
                border: `1px solid ${range === r ? 'rgba(247,147,26,0.3)' : 'var(--border-lo)'}`,
              }}>
              {r === '180d' ? '6mo' : r}
            </button>
          ))}
          <button onClick={() => run(connectedAddress, range)} disabled={loading}
            className="rounded-xl px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-40"
            style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-lo)', color: 'var(--text-secondary)' }}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-2.5 text-sm"
          style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171' }}>
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {loading && <PillLoader />}

      <AnimatePresence>
        {analysis && !loading && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: E }} className="space-y-6">

            {/* Price warnings */}
            {(analysis.priceWarnings?.length ?? 0) > 0 && (
              <div className="rounded-xl px-4 py-3 flex items-start gap-2.5 text-xs"
                style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.22)', color: '#f59e0b' }}>
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="space-y-0.5">
                  {analysis.priceWarnings!.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              </div>
            )}

            {/* Key stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Monthly Burn', value: burnValue, sub: burnSub, accent: '#F7931A' },
                { label: 'Recurring', value: String(analysis.recurringPayments.length), sub: 'patterns detected', accent: '#00c9a7' },
                { label: 'Runway', value: analysis.runway, sub: 'at current burn rate', accent: '#22c55e' },
                { label: 'Reserve Score', value: `${analysis.reserveScore}/100`, sub: 'liquidity health', accent: '#a78bfa' },
              ].map(s => (
                <div key={s.label} className="flex flex-col gap-1 rounded-2xl p-5"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)' }}>
                  <span className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: s.accent }}>{s.label}</span>
                  <span className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>{s.value}</span>
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{s.sub}</span>
                </div>
              ))}
            </div>

            {/* Chart + Categories */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)' }}>
                <p className="text-xs font-bold uppercase tracking-[0.18em] mb-4" style={{ color: 'var(--text-muted)' }}>Spend Over Time</p>
                <SpendChart transactions={analysis.transactions} />
              </div>
              <div className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)' }}>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>Spend by Category</p>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {analysis.totalOutflow > 0 ? fmtUSD(analysis.totalOutflow) : '—'}
                  </span>
                </div>
                <div className="space-y-3">
                  {analysis.spendByCategory.length === 0
                    ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No category data in range</p>
                    : analysis.spendByCategory.map(c => <CategoryBar key={c.category} {...c} />)}
                </div>
              </div>
            </div>

            {/* Recurring patterns */}
            {analysis.recurringPayments.length > 0 && (
              <div className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)' }}>
                <p className="text-xs font-bold uppercase tracking-[0.18em] mb-4" style={{ color: 'var(--text-muted)' }}>
                  Recurring Patterns · Auto-detected
                </p>
                <div className="space-y-3">
                  {analysis.recurringPayments.map((r, i) => (
                    <div key={i} className="flex items-center gap-4 rounded-xl px-4 py-3"
                      style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-lo)' }}>
                      <Repeat className="h-4 w-4 shrink-0" style={{ color: '#00c9a7' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{shortAddr(r.toAddress)}</span>
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
                            style={{ background: 'rgba(0,201,167,0.12)', color: '#00c9a7', border: '1px solid rgba(0,201,167,0.24)' }}>
                            {r.frequency}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{r.occurrences} occurrences</span>
                        </div>
                        {r.nextExpected && (
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            Next expected: {new Date(r.nextExpected).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {r.usdAvailable && r.amountUSD > 0 ? fmtUSD(r.amountUSD) : fmtTokenAmt(r.amount, r.token)}
                        </div>
                        <div className="text-[10px]" style={{ color: '#00c9a7' }}>
                          {Math.round(r.confidence * 100)}% confidence
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Transactions */}
            <div className="rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)' }}>
              <div className="flex items-center justify-between px-5 py-4"
                style={{ borderBottom: '1px solid var(--border-lo)' }}>
                <div className="flex items-center gap-3">
                  <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
                    Transactions
                  </p>
                  <span className="rounded-full px-2 py-0.5 text-[10px]"
                    style={{ background: 'var(--bg-raised)', color: 'var(--text-muted)' }}>
                    {visibleTxs.length} shown
                  </span>
                </div>
                {filteredCount > 0 && (
                  <button onClick={() => setShowFiltered(v => !v)}
                    className="flex items-center gap-1.5 text-xs"
                    style={{ color: 'var(--text-muted)' }}>
                    {showFiltered ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {showFiltered ? `Hide ${filteredCount} filtered` : `Show ${filteredCount} filtered`}
                  </button>
                )}
              </div>
              <div className="divide-y-0">
                {visibleTxs.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    No transactions in this range
                  </p>
                ) : (
                  visibleTxs.map(tx => (
                    <TxRow key={`${tx.hash}-${tx.token}`}
                      tx={tx}
                      walletAddress={connectedAddress}
                      tag={userTags[tx.hash]}
                      onTagged={handleTag} />
                  ))
                )}
              </div>
            </div>

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
