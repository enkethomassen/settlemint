'use client';
import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ArrowRight, RefreshCw, Tag, Eye, EyeOff, TrendingDown, Clock, Shield, Repeat } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { walletApi, type TransactionCategory, type WalletAnalysis, type WalletTransaction, type TransactionTag } from '@/lib/api';

const E: [number,number,number,number] = [0.16, 1, 0.3, 1];
const _rawUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
const API = !_rawUrl || /localhost|127\.0\.0\.1/.test(_rawUrl) ? "" : _rawUrl;

type RangeOption = '30d' | '90d' | '180d';
type TabId = 'transactions' | 'recurring' | 'insights' | 'tags';

function detectType(addr: string): 'evm' | 'bitcoin' | null {
  const a = addr.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(a)) return 'evm';
  if (/^(1|3)[a-zA-HJ-NP-Z0-9]{25,34}$/.test(a) || /^bc1[a-zA-HJ-NP-Z0-9]{6,87}$/.test(a)) return 'bitcoin';
  return null;
}

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

const CATEGORY_COLORS: Record<string, string> = {
  payment: '#F7931A',
  subscription: '#00c9a7',
  yield: '#22c55e',
  transfer: '#3b82f6',
  stablecoin: '#a78bfa',
  nft: '#f59e0b',
  unknown: '#6b6784',
};

const TAG_PRESETS: Array<{ label: string; category: TransactionCategory }> = [
  // Payments
  { label: 'Salary', category: 'payment' },
  { label: 'Payroll', category: 'payment' },
  { label: 'Invoice', category: 'payment' },
  { label: 'Bill', category: 'payment' },
  { label: 'Rent', category: 'payment' },
  { label: 'Tax', category: 'payment' },
  { label: 'Vendor', category: 'payment' },
  { label: 'Infrastructure', category: 'payment' },
  // Subscriptions / x402
  { label: 'x402 API', category: 'subscription' },
  { label: 'Subscription', category: 'subscription' },
  { label: 'Software', category: 'subscription' },
  { label: 'SaaS', category: 'subscription' },
  // Funding
  { label: 'Grant', category: 'transfer' },
  { label: 'Hackathon', category: 'transfer' },
  { label: 'Investment', category: 'transfer' },
  { label: 'Reward', category: 'transfer' },
  // DeFi
  { label: 'Yield', category: 'yield' },
  { label: 'Swap', category: 'swap' },
];


// ── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent = '#F7931A' }: {
  label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl p-5"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)' }}>
      <span className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: accent }}>{label}</span>
      <span className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>{value}</span>
      {sub && <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{sub}</span>}
    </div>
  );
}

// ── Category Bar ─────────────────────────────────────────────────────────────
function CategoryBar({ category, amountUSD, percentage }: { category: string; amountUSD: number; percentage: number }) {
  const color = CATEGORY_COLORS[category] ?? '#6b6784';
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 text-xs capitalize shrink-0" style={{ color: 'var(--text-secondary)' }}>{category}</span>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-raised)' }}>
        <motion.div className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, ease: E }} />
      </div>
      <span className="w-16 text-right text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{fmtUSD(amountUSD)}</span>
      <span className="w-8 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{percentage}%</span>
    </div>
  );
}


// ── Tag Popover ──────────────────────────────────────────────────────────────
function TagPopover({ tx, walletAddress, existingTag, onTagged }: {
  tx: WalletTransaction; walletAddress: string; existingTag?: string; onTagged: (tag: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(existingTag ?? tx.predictedTag ?? '');
  const [category, setCategory] = useState<TransactionCategory>(tx.category === 'unknown' ? 'payment' : tx.category);
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
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors"
        style={{ background: existingTag ? 'rgba(247,147,26,0.12)' : 'var(--bg-raised)', color: existingTag ? '#F7931A' : 'var(--text-muted)', border: `1px solid ${existingTag ? 'rgba(247,147,26,0.28)' : 'var(--border-lo)'}` }}>
        <Tag className="h-3 w-3" />
        {existingTag ?? (tx.predictedTag ? `AI: ${tx.predictedTag}` : 'Tag')}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-8 z-50 rounded-xl p-3 shadow-2xl w-56"
            style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-hi)' }}>
            {tx.predictedTag && (
              <button onClick={() => setVal(tx.predictedTag!)}
                className="mb-2 w-full text-left text-xs px-2 py-1 rounded-lg"
                style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
                Use AI: <span style={{ color: '#F7931A' }}>{tx.predictedTag}</span>
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


// ── Transaction Row ──────────────────────────────────────────────────────────
function TxRow({ tx, walletAddress, tag, onTagged }: {
  tx: WalletTransaction; walletAddress: string; tag?: string; onTagged: (hash: string, tag: string) => void;
}) {
  const color = CATEGORY_COLORS[tx.category] ?? '#6b6784';
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors hover:bg-white/[0.02]"
      style={{ borderBottom: '1px solid var(--border-void)' }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>{shortAddr(tx.hash)}</span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
            style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}>
            {tx.category}
          </span>
        </div>
        <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          → {shortAddr(tx.to)} · {fmtDate(tx.timestamp)}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {tx.amountUSD > 0 ? fmtUSD(tx.amountUSD) : tx.amount > 0 ? fmtUSD(0) : <span style={{ color: 'var(--text-muted)' }}>contract call</span>}
        </div>
        <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          {tx.amount > 0 ? `${tx.amount.toFixed(6)} ${tx.token}` : ''}
        </div>
      </div>
      <TagPopover tx={tx} walletAddress={walletAddress} existingTag={tag}
        onTagged={(t) => onTagged(tx.hash, t)} />
    </div>
  );
}


// ── Spend Chart ──────────────────────────────────────────────────────────────
function SpendChart({ transactions }: { transactions: WalletTransaction[] }) {
  // Group by week
  const buckets: Record<string, number> = {};
  for (const tx of transactions.filter(t => !t.isFiltered)) {
    const d = new Date(tx.timestamp * 1000);
    const key = `${d.getMonth() + 1}/${d.getDate()}`;
    buckets[key] = (buckets[key] ?? 0) + tx.amountUSD;
  }
  const data = Object.entries(buckets)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([date, usd]) => ({ date, usd: Math.round(usd * 100) / 100 }));

  if (data.length === 0) return (
    <div className="flex items-center justify-center h-32 text-sm" style={{ color: 'var(--text-muted)' }}>
      No spend data to chart
    </div>
  );

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: 'var(--bg-raised)', border: '1px solid var(--border-base)', borderRadius: 10, fontSize: 12 }}
          formatter={((v: unknown) => [fmtUSD(Number(v ?? 0)), 'Spend']) as any} />
        <Bar dataKey="usd" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill="#F7931A" fillOpacity={0.75 + (i / data.length) * 0.25} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}


// ── Main Page ────────────────────────────────────────────────────────────────
export default function AnalyzePage() {
  const [input, setInput] = useState('');
  const [range, setRange] = useState<RangeOption>('90d');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<WalletAnalysis | null>(null);
  const [tab, setTab] = useState<TabId>('transactions');
  const [showFiltered, setShowFiltered] = useState(false);
  const [userTags, setUserTags] = useState<Record<string, string>>({});
  const [savedTags, setSavedTags] = useState<TransactionTag[]>([]);

  const run = useCallback(async (addr?: string) => {
    const address = (addr ?? input).trim();
    if (!address) return;
    const type = detectType(address);
    if (!type) { setError('Unrecognized address format. Enter an EVM (0x…) or Bitcoin address.'); return; }
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const result = await walletApi.analyze(address, type, range);
      setAnalysis(result);
      // Load saved tags
      const tagRes = await walletApi.getTags(address).catch(() => ({ tags: [] }));
      setSavedTags(tagRes.tags);
      const tagMap: Record<string, string> = {};
      for (const t of tagRes.tags) tagMap[t.txHash] = t.userTag;
      setUserTags(tagMap);
    } catch (e: any) {
      setError(e.message ?? 'Analysis failed');
    }
    setLoading(false);
  }, [input, range]);

  const handleTag = useCallback((hash: string, tag: string) => {
    setUserTags(prev => ({ ...prev, [hash]: tag }));
  }, []);

  const visibleTxs = analysis
    ? (showFiltered ? analysis.transactions : analysis.transactions.filter(t => !t.isFiltered))
    : [];
  const filteredCount = analysis ? analysis.transactions.filter(t => t.isFiltered).length : 0;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <div className="sticky top-0 z-40 px-6 py-4 flex items-center justify-between"
        style={{ background: 'rgba(11,11,14,0.85)', backdropFilter: 'blur(16px)', borderBottom: '1px solid var(--border-lo)' }}>
        <a href="/" className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
          <svg width="24" height="24" viewBox="0 0 64 64" fill="none"><polygon points="4,4 60,4 60,44 20,60 4,60" fill="#F7931A"/><rect x="13" y="13" width="22" height="22" rx="3" fill="#0b0b0b"/></svg>
          <span style={{ color: 'var(--text-primary)' }}>bit</span><span style={{ color: '#F7931A' }}>stream</span>
        </a>
        <span className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: '#F7931A' }}>Wallet Analyzer</span>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-10">
        {/* Search bar */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: E }}>
          <h1 className="text-center text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.04em' }}>
            Analyze any wallet
          </h1>
          <p className="text-center text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>
            EVM or Bitcoin · No wallet connection required
          </p>
          <div className="flex gap-2 max-w-2xl mx-auto">
            <div className="flex-1 flex items-center gap-3 rounded-2xl px-4"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)' }}>
              <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && run()}
                placeholder="0x… or bc1… or 1BTC…"
                className="flex-1 bg-transparent py-3.5 text-sm outline-none"
                style={{ color: 'var(--text-primary)' }} />
            </div>
            <select value={range} onChange={e => setRange(e.target.value as RangeOption)}
              className="rounded-2xl px-3 text-sm outline-none"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)', color: 'var(--text-secondary)' }}>
              <option value="30d">30d</option>
              <option value="90d">90d</option>
              <option value="180d">180d</option>
            </select>
            <button onClick={() => run()} disabled={loading || !input.trim()}
              className="flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
              style={{ background: '#F7931A', color: '#000' }}>
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <><span>Analyze</span><ArrowRight className="h-4 w-4" /></>}
            </button>
          </div>
          {error && (
            <p className="mt-3 text-center text-sm" style={{ color: 'var(--red)' }}>{error}</p>
          )}
        </motion.div>


        {/* Loading skeleton */}
        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-10 space-y-4">
            {[1,2,3,4].map(i => (
              <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: 'var(--bg-card)' }} />
            ))}
          </motion.div>
        )}

        {/* Results */}
        <AnimatePresence>
          {analysis && !loading && (
            <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: E }} className="mt-10 space-y-6">

              {/* Address chip */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl px-3 py-1.5 text-xs font-mono flex items-center gap-2"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)', color: 'var(--text-secondary)' }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: analysis.addressType === 'bitcoin' ? '#F7931A' : '#00c9a7' }} />
                    {shortAddr(analysis.address)}
                    <span className="rounded-full px-1.5 py-0.5 text-[10px]"
                      style={{ background: 'var(--bg-raised)', color: 'var(--text-muted)' }}>
                      {analysis.transactions.length} txs
                    </span>
                  </div>
                  <button onClick={() => { setAnalysis(null); setInput(''); }}
                    className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Scan different wallet
                  </button>
                </div>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Range: {analysis.range}</span>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Monthly Burn" value={fmtUSD(analysis.monthlyBurn)} sub="avg outflow/month" accent="#F7931A" />
                <StatCard label="Recurring" value={String(analysis.recurringPayments.length)} sub="patterns detected" accent="#00c9a7" />
                <StatCard label="Runway" value={analysis.runway} sub="at current burn rate" accent="#22c55e" />
                <StatCard label="Reserve Score" value={`${analysis.reserveScore}/100`} sub="liquidity health" accent="#a78bfa" />
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
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtUSD(analysis.totalOutflow)}</span>
                  </div>
                  <div className="space-y-3">
                    {analysis.spendByCategory.map(c => (
                      <CategoryBar key={c.category} {...c} />
                    ))}
                    {analysis.spendByCategory.length === 0 && (
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No category data</p>
                    )}
                  </div>
                </div>
              </div>


              {/* Tabs */}
              <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)' }}>
                <div className="flex border-b" style={{ borderColor: 'var(--border-lo)' }}>
                  {([
                    { id: 'transactions', label: 'Transactions', icon: TrendingDown },
                    { id: 'recurring',    label: 'Recurring',    icon: Repeat },
                    { id: 'insights',     label: 'AI Insights',  icon: Shield },
                    { id: 'tags',         label: 'Tags',         icon: Tag },
                  ] as { id: TabId; label: string; icon: any }[]).map(({ id, label, icon: Icon }) => (
                    <button key={id} onClick={() => setTab(id)}
                      className="flex items-center gap-2 px-5 py-3.5 text-xs font-semibold transition-colors relative"
                      style={{ color: tab === id ? '#F7931A' : 'var(--text-muted)' }}>
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                      {tab === id && (
                        <motion.div layoutId="tab-indicator" className="absolute bottom-0 left-0 right-0 h-0.5"
                          style={{ background: '#F7931A' }} />
                      )}
                    </button>
                  ))}
                </div>

                <div className="p-4">
                  {/* Transactions tab */}
                  {tab === 'transactions' && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {visibleTxs.length} transactions shown
                        </span>
                        {filteredCount > 0 && (
                          <button onClick={() => setShowFiltered(s => !s)}
                            className="flex items-center gap-1.5 text-xs"
                            style={{ color: 'var(--text-muted)' }}>
                            {showFiltered ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            {showFiltered ? 'Hide' : 'Show'} {filteredCount} filtered (noise)
                          </button>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        {visibleTxs.slice(0, 50).map(tx => (
                          <TxRow key={tx.hash} tx={tx} walletAddress={analysis.address}
                            tag={userTags[tx.hash]} onTagged={handleTag} />
                        ))}
                        {visibleTxs.length === 0 && (
                          <p className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                            No transactions in this range
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Recurring tab */}
                  {tab === 'recurring' && (
                    <div className="space-y-3">
                      {analysis.recurringPayments.length === 0 && (
                        <p className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No recurring patterns detected</p>
                      )}
                      {analysis.recurringPayments.map((r, i) => (
                        <div key={i} className="flex items-center gap-4 rounded-xl p-4"
                          style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-lo)' }}>
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0"
                            style={{ background: 'rgba(247,147,26,0.12)', border: '1px solid rgba(247,147,26,0.24)' }}>
                            <Repeat className="h-4 w-4" style={{ color: '#F7931A' }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {r.toLabel ?? shortAddr(r.toAddress)}
                              </span>
                              <span className="rounded-full px-2 py-0.5 text-[10px] capitalize"
                                style={{ background: 'rgba(0,201,167,0.12)', color: '#00c9a7', border: '1px solid rgba(0,201,167,0.24)' }}>
                                {r.frequency}
                              </span>
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                              {r.occurrences} occurrences · {fmtUSD(r.totalSpent)} total
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtUSD(r.amountUSD)}</div>
                            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>per {r.frequency.replace('ly','')}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xs" style={{ color: r.confidence > 0.8 ? '#22c55e' : '#f59e0b' }}>
                              {Math.round(r.confidence * 100)}% confidence
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}


                  {/* AI Insights tab */}
                  {tab === 'insights' && (
                    <div className="space-y-3 py-2">
                      {analysis.aiInsights.length === 0 && (
                        <p className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No insights generated</p>
                      )}
                      {analysis.aiInsights.map((insight, i) => (
                        <motion.div key={i}
                          initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.4, ease: E, delay: i * 0.08 }}
                          className="flex items-start gap-3 rounded-xl p-4"
                          style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-lo)' }}>
                          <div className="mt-0.5 h-5 w-5 shrink-0 flex items-center justify-center rounded-full text-xs font-bold"
                            style={{ background: 'rgba(247,147,26,0.14)', color: '#F7931A' }}>
                            {i + 1}
                          </div>
                          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{insight}</p>
                        </motion.div>
                      ))}
                      {/* CTA */}
                      <div className="mt-6 rounded-2xl p-6 text-center"
                        style={{ background: 'linear-gradient(135deg, rgba(247,147,26,0.08), rgba(0,201,167,0.06))', border: '1px solid rgba(247,147,26,0.2)' }}>
                        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                          Want Bitstream to automate this for you?
                        </p>
                        <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
                          Lock BTC, mint MUSD, and let the agent handle recurring payments automatically.
                        </p>
                        <a href="/" className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold"
                          style={{ background: '#F7931A', color: '#000' }}>
                          Connect Mezo Passport <ArrowRight className="h-4 w-4" />
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Tags tab */}
                  {tab === 'tags' && (
                    <div className="space-y-2">
                      {savedTags.length === 0 && Object.keys(userTags).length === 0 && (
                        <p className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                          No tags yet. Click the tag icon on any transaction to label it.
                        </p>
                      )}
                      {Object.entries(userTags).map(([hash, tag]) => (
                        <div key={hash} className="flex items-center gap-3 rounded-xl px-4 py-3"
                          style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-lo)' }}>
                          <Tag className="h-3.5 w-3.5 shrink-0" style={{ color: '#F7931A' }} />
                          <span className="font-mono text-xs flex-1" style={{ color: 'var(--text-muted)' }}>{shortAddr(hash)}</span>
                          <span className="rounded-full px-3 py-1 text-xs font-semibold"
                            style={{ background: 'rgba(247,147,26,0.12)', color: '#F7931A', border: '1px solid rgba(247,147,26,0.24)' }}>
                            {tag}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
