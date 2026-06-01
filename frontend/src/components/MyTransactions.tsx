'use client';
/**
 * MyTransactions — owner-gated transaction management (Bug 2 / Feature 2).
 *
 * Replaces the broken inline tagging that lived on the public WalletAnalyzer.
 * Only renders for the user's OWN connected wallet, so tags, category overrides
 * and notes are meaningful (tied to a wallet the user controls).
 *
 * Tags/overrides/notes persist per (walletAddress, txHash) via /api/wallet/tag
 * and are the substrate the classifier can later learn from.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Tag, ChevronDown, Copy, Check, Wallet, Download, RefreshCw, X } from 'lucide-react';
import {
  walletApi,
  type TransactionCategory,
  type WalletAnalysis,
  type WalletTransaction,
  type TransactionTag,
} from '@/lib/api';

const E: [number, number, number, number] = [0.16, 1, 0.3, 1];

const CATEGORY_COLORS: Record<string, string> = {
  payment: '#F7931A',
  subscription: '#00c9a7',
  yield: '#22c55e',
  swap: '#a78bfa',
  transfer: '#3b82f6',
  stablecoin: '#a78bfa',
  gas: '#6b6784',
  nft: '#f59e0b',
  unknown: '#6b6784',
};

const CATEGORIES: TransactionCategory[] = [
  'payment', 'subscription', 'yield', 'swap', 'transfer', 'stablecoin', 'gas', 'nft', 'unknown',
];

function shortAddr(a: string) {
  if (!a || a.length < 12) return a || '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtUSD(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}

function fmtDate(ts: number) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

// Heuristic classification certainty (no LLM is wired yet — see AI_PROVIDER).
// Contract-call-derived categories are more certain than bare transfers.
function confidenceFor(tx: WalletTransaction): number {
  if (typeof tx.confidence === 'number') return tx.confidence;
  switch (tx.category) {
    case 'gas': return 0.95;
    case 'swap':
    case 'yield':
    case 'subscription':
    case 'payment': return 0.8;
    case 'transfer': return 0.6;
    default: return 0.4;
  }
}

function CopyAddr({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  if (!address) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-1 font-mono"
      style={{ color: 'var(--text-secondary)', fontSize: '12px' }}
      title={address}
    >
      {shortAddr(address)}
      {copied ? <Check className="h-3 w-3" style={{ color: '#22c55e' }} /> : <Copy className="h-3 w-3 opacity-50" />}
    </button>
  );
}

interface RowState {
  tag: string;
  category: TransactionCategory;
  note: string;
}

export default function MyTransactions({ walletAddress }: { walletAddress: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<WalletAnalysis | null>(null);
  const [tags, setTags] = useState<Record<string, TransactionTag>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draft, setDraft] = useState<RowState | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterCat, setFilterCat] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState<TransactionCategory>('payment');
  const [bulkSaving, setBulkSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, tagRes] = await Promise.all([
        walletApi.analyze(walletAddress, 'evm', '90d'),
        walletApi.getTags(walletAddress).catch(() => ({ tags: [] })),
      ]);
      setAnalysis(res);
      const map: Record<string, TransactionTag> = {};
      for (const t of tagRes.tags) map[t.txHash] = t;
      setTags(map);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load your transactions.');
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => { load(); }, [load]);

  // Only the wallet's own, meaningful transactions (noise already filtered server-side).
  const txs = useMemo(() => {
    if (!analysis) return [];
    const list = analysis.transactions.filter(t => !t.isFiltered);
    return filterCat === 'all' ? list : list.filter(t => t.category === filterCat);
  }, [analysis, filterCat]);

  const openRow = (tx: WalletTransaction) => {
    if (expanded === tx.hash) { setExpanded(null); setDraft(null); return; }
    const existing = tags[tx.hash];
    setExpanded(tx.hash);
    setDraft({
      tag: existing?.userTag ?? tx.predictedTag ?? '',
      category: (existing?.category as TransactionCategory) ?? tx.category,
      note: existing?.note ?? '',
    });
  };

  const saveRow = async (tx: WalletTransaction) => {
    if (!draft) return;
    setSaving(true);
    try {
      const { tag } = await walletApi.addTag(
        tx.hash, walletAddress, draft.tag.trim(), draft.category, draft.note.trim(),
      );
      setTags(prev => ({ ...prev, [tx.hash]: tag }));
      setExpanded(null);
      setDraft(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const removeRow = async (tx: WalletTransaction) => {
    setSaving(true);
    try {
      await walletApi.deleteTag(tx.hash, walletAddress);
      setTags(prev => { const next = { ...prev }; delete next[tx.hash]; return next; });
      setExpanded(null);
      setDraft(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to remove. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggleSelect = (hash: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(hash) ? next.delete(hash) : next.add(hash);
      return next;
    });
  };

  // Bulk: assign one category to every selected tx (merges with any existing
  // tag/note server-side).
  const applyBulkCategory = async () => {
    if (selected.size === 0) return;
    setBulkSaving(true);
    setError(null);
    try {
      const updated = await Promise.all(
        [...selected].map(hash => {
          const existing = tags[hash];
          return walletApi.addTag(hash, walletAddress, existing?.userTag, bulkCat, existing?.note);
        }),
      );
      setTags(prev => {
        const next = { ...prev };
        for (const { tag } of updated) next[tag.txHash] = tag;
        return next;
      });
      setSelected(new Set());
    } catch (e: any) {
      setError(e?.message ?? 'Bulk update failed. Try again.');
    } finally {
      setBulkSaving(false);
    }
  };

  const exportCsv = () => {
    const rows = [['date', 'category', 'counterparty', 'amount', 'token', 'amountUSD', 'tag', 'note', 'txHash']];
    for (const tx of txs) {
      const t = tags[tx.hash];
      const out = tx.from.toLowerCase() === walletAddress.toLowerCase();
      rows.push([
        fmtDate(tx.timestamp), t?.category ?? tx.category, out ? tx.to : tx.from,
        String(tx.amount), tx.token, String(Math.round(tx.amountUSD * 100) / 100),
        t?.userTag ?? '', (t?.note ?? '').replace(/[\r\n,]+/g, ' '), tx.hash,
      ]);
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `bitstream-transactions-${walletAddress.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card-base p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <h3 className="font-bold" style={{ color: 'var(--text-primary)', fontSize: '1rem' }}>My Transactions</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Tag, re-categorize, and annotate your own wallet activity · {shortAddr(walletAddress)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterCat}
            onChange={e => setFilterCat(e.target.value)}
            className="rounded-lg px-2.5 py-1.5 text-xs outline-none"
            style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-base)', color: 'var(--text-secondary)' }}
          >
            <option value="all">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs disabled:opacity-50"
            style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-base)', color: 'var(--text-secondary)' }}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          {txs.length > 0 && (
            <button onClick={exportCsv}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
              style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-base)', color: 'var(--text-secondary)' }}>
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: 'var(--bg-raised)' }} />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm" style={{ color: 'var(--red, #ef4444)' }}>{error}</p>
          <button onClick={load} className="btn-primary" style={{ padding: '8px 18px', fontSize: 13 }}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && txs.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl"
            style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-base)' }}>
            <Wallet className="h-5 w-5" style={{ color: 'var(--text-muted)' }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>No transactions to manage yet</p>
          <p className="text-xs max-w-xs" style={{ color: 'var(--text-muted)' }}>
            {filterCat === 'all'
              ? 'Once this wallet has on-chain activity in the last 90 days, you can tag and categorize it here.'
              : `No “${filterCat}” transactions in the last 90 days.`}
          </p>
          {filterCat !== 'all' && (
            <button onClick={() => setFilterCat('all')} className="btn-ghost" style={{ fontSize: 12, color: 'var(--accent)' }}>
              Show all categories
            </button>
          )}
        </div>
      )}

      {/* Table */}
      {!loading && !error && txs.length > 0 && (
        <div>
          {/* Bulk action bar */}
          <AnimatePresence>
            {selected.size > 0 && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                className="flex items-center gap-2 flex-wrap mb-3 rounded-xl px-3 py-2"
                style={{ background: 'rgba(247,147,26,0.08)', border: '1px solid rgba(247,147,26,0.24)' }}>
                <span className="text-xs font-semibold" style={{ color: '#F7931A' }}>{selected.size} selected</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· set category</span>
                <select value={bulkCat} onChange={e => setBulkCat(e.target.value as TransactionCategory)}
                  className="rounded-lg px-2 py-1 text-xs outline-none capitalize"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)', color: 'var(--text-secondary)' }}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button onClick={applyBulkCategory} disabled={bulkSaving}
                  className="rounded-lg px-3 py-1 text-xs font-semibold disabled:opacity-50" style={{ background: '#F7931A', color: '#000' }}>
                  {bulkSaving ? 'Applying…' : 'Apply'}
                </button>
                <button onClick={() => setSelected(new Set())}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs"
                  style={{ background: 'transparent', border: '1px solid var(--border-base)', color: 'var(--text-muted)' }}>
                  <X className="h-3 w-3" /> Clear
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-1">
          {txs.slice(0, 50).map(tx => {
            const saved = tags[tx.hash];
            const out = tx.from.toLowerCase() === walletAddress.toLowerCase();
            const counterparty = out ? tx.to : tx.from;
            const category = saved?.category ?? tx.category;
            const color = CATEGORY_COLORS[category] ?? '#6b6784';
            const conf = confidenceFor(tx);
            const isOpen = expanded === tx.hash;

            return (
              <div key={tx.hash} className="rounded-xl"
                style={{ border: `1px solid ${isOpen ? 'var(--border-hi, var(--border-base))' : 'transparent'}`, background: isOpen ? 'var(--bg-raised)' : 'transparent' }}>
                {/* Row */}
                <div onClick={() => openRow(tx)} role="button" tabIndex={0}
                  className="w-full flex items-center gap-3 px-3 py-3 text-left rounded-xl transition-colors hover:bg-white/[0.02] cursor-pointer"
                  style={{ borderBottom: isOpen ? 'none' : '1px solid var(--border-void)' }}>
                  {/* select checkbox */}
                  <button onClick={e => { e.stopPropagation(); toggleSelect(tx.hash); }}
                    aria-label="Select transaction"
                    className="h-4 w-4 rounded-[5px] flex items-center justify-center shrink-0"
                    style={{ background: selected.has(tx.hash) ? '#F7931A' : 'transparent', border: `1.5px solid ${selected.has(tx.hash) ? '#F7931A' : 'var(--border-base)'}` }}>
                    {selected.has(tx.hash) && <Check className="h-3 w-3" style={{ color: '#000' }} />}
                  </button>
                  {/* date + counterparty */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
                        style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}>
                        {category}
                      </span>
                      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {out ? 'to' : 'from'} <span onClick={e => e.stopPropagation()}><CopyAddr address={counterparty} /></span>
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{fmtDate(tx.timestamp)}</span>
                      {saved?.userTag && (
                        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ background: 'rgba(247,147,26,0.12)', color: '#F7931A', border: '1px solid rgba(247,147,26,0.24)' }}>
                          <Tag className="h-2.5 w-2.5" /> {saved.userTag}
                        </span>
                      )}
                      {saved?.note && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>📝 note</span>}
                    </div>
                  </div>

                  {/* confidence */}
                  <div className="hidden sm:flex flex-col items-end w-20 shrink-0">
                    <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-card)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.round(conf * 100)}%`, background: conf > 0.7 ? '#22c55e' : '#f59e0b' }} />
                    </div>
                    <span className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{Math.round(conf * 100)}% conf</span>
                  </div>

                  {/* value — token + USD */}
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold" style={{ color: out ? 'var(--text-primary)' : '#22c55e' }}>
                      {out ? '-' : '+'}{fmtUSD(tx.amountUSD)}
                    </div>
                    <div className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                      {tx.amount.toFixed(6)} {tx.token}
                    </div>
                  </div>
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform" style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
                </div>

                {/* Expanded editor */}
                <AnimatePresence>
                  {isOpen && draft && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: E }} style={{ overflow: 'hidden' }}>
                      <div className="px-3 pb-4 pt-1 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <label className="block">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>Tag</span>
                            <input value={draft.tag} onChange={e => setDraft(d => d && { ...d, tag: e.target.value })}
                              placeholder="e.g. payroll, vendor, grant"
                              className="mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none"
                              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }} />
                          </label>
                          <label className="block">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>Category override</span>
                            <select value={draft.category} onChange={e => setDraft(d => d && { ...d, category: e.target.value as TransactionCategory })}
                              className="mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none capitalize"
                              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)', color: 'var(--text-secondary)' }}>
                              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </label>
                        </div>
                        <label className="block">
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>Notes</span>
                          <textarea value={draft.note} onChange={e => setDraft(d => d && { ...d, note: e.target.value })}
                            rows={2} placeholder="Why this transaction matters…"
                            className="mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none resize-none"
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }} />
                        </label>
                        <div className="flex items-center justify-between gap-2">
                          <a href={`https://explorer.matsnet.mezo.org/tx/${tx.hash}`} target="_blank" rel="noreferrer"
                            className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                            {shortAddr(tx.hash)} ↗
                          </a>
                          <div className="flex items-center gap-2">
                            {saved && (
                              <button onClick={() => removeRow(tx)} disabled={saving}
                                className="rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                                style={{ background: 'transparent', border: '1px solid var(--border-base)', color: 'var(--red, #ef4444)' }}>
                                Remove
                              </button>
                            )}
                            <button onClick={() => saveRow(tx)} disabled={saving}
                              className="rounded-lg px-4 py-1.5 text-xs font-semibold disabled:opacity-50"
                              style={{ background: '#F7931A', color: '#000' }}>
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
}
