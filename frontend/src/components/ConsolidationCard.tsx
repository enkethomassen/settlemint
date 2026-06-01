'use client';
/**
 * ConsolidationCard — "Monthly Consolidation" (Feature 1).
 *
 * Lets the user roll their token holdings into MUSD (the unit of account for
 * payments). Balances + prices are real (Mezo explorer + live BTC); execution
 * queues a request that respects the agent's Safe/Autopilot mode — it does not
 * fabricate swaps. Tokens without a known price can't be consolidated and are
 * shown disabled.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeftRight, AlertTriangle, RefreshCw, CheckCircle2, Calendar, Zap, Coins,
} from 'lucide-react';
import {
  consolidationApi, agentApi,
  type ConsolidationToken, type ConsolidationPreviewResult, type ConsolidationRequest,
} from '@/lib/api';

const E: [number, number, number, number] = [0.16, 1, 0.3, 1];

function fmtUSD(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}
function fmtMUSD(n: number) {
  return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} MUSD`;
}
function fmtToken(n: number) {
  return n < 0.0001 ? n.toExponential(2) : n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}
function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function TokenIcon({ token }: { token: ConsolidationToken }) {
  if (token.iconUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={token.iconUrl} alt={token.symbol} className="h-7 w-7 rounded-full shrink-0" />;
  }
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full shrink-0"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)' }}>
      <Coins className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
    </div>
  );
}

export default function ConsolidationCard({ walletAddress }: { walletAddress: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ConsolidationPreviewResult | null>(null);
  const [mode, setMode] = useState<'safe' | 'autopilot'>('safe');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState<null | 'now' | 'month_end'>(null);
  const [done, setDone] = useState<ConsolidationRequest | null>(null);
  const [doneMsg, setDoneMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDone(null);
    try {
      const [pre, settings] = await Promise.all([
        consolidationApi.preview(walletAddress),
        agentApi.getSettings(walletAddress).catch(() => null),
      ]);
      setPreview(pre);
      if (settings?.mode) setMode(settings.mode);
      // Default: unpriced tokens excluded (can't be consolidated).
      setExcluded(new Set(pre.tokens.filter(t => !t.priceAvailable).map(t => t.contract)));
    } catch (e: any) {
      setError(e?.message ?? 'Could not load your token balances.');
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => { load(); }, [load]);

  const toggle = (t: ConsolidationToken) => {
    if (!t.priceAvailable) return;
    setExcluded(prev => {
      const next = new Set(prev);
      next.has(t.contract) ? next.delete(t.contract) : next.add(t.contract);
      return next;
    });
  };

  const selected = useMemo(
    () => (preview?.tokens ?? []).filter(t => t.priceAvailable && !excluded.has(t.contract)),
    [preview, excluded],
  );
  const totalSelectedMUSD = useMemo(() => selected.reduce((s, t) => s + t.estimatedMUSD, 0), [selected]);

  const execute = async (schedule: 'now' | 'month_end') => {
    if (selected.length === 0) return;
    setSubmitting(schedule);
    setError(null);
    try {
      const res = await consolidationApi.execute(walletAddress, selected.map(t => t.contract), schedule);
      setDone(res.request);
      setDoneMsg(res.message);
    } catch (e: any) {
      setError(e?.message ?? 'Consolidation failed. Try again.');
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="card-base p-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0"
            style={{ background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.24)' }}>
            <ArrowLeftRight className="h-5 w-5" style={{ color: '#a78bfa' }} />
          </div>
          <div>
            <h3 className="font-bold" style={{ color: 'var(--text-primary)', fontSize: '1rem' }}>Monthly Consolidation</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Roll your tokens into MUSD for payments · {mode === 'safe' ? 'Safe mode — you approve each swap' : 'Autopilot — auto-executes'}
            </p>
          </div>
        </div>
        {!loading && !done && (
          <button onClick={load} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
            style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-base)', color: 'var(--text-secondary)' }}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: 'var(--bg-raised)' }} />)}
        </div>
      )}

      {/* Error */}
      {!loading && error && !done && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertTriangle className="h-5 w-5" style={{ color: 'var(--amber, #d97706)' }} />
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{error}</p>
          <button onClick={load} className="btn-primary" style={{ padding: '8px 18px', fontSize: 13 }}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      )}

      {/* Success / report */}
      <AnimatePresence>
        {done && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: E, duration: 0.3 }}>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-5 w-5" style={{ color: '#22c55e' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {done.status === 'pending_approval' ? 'Consolidation request created' : 'Consolidation queued'}
              </p>
            </div>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>{doneMsg}</p>
            <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-base)' }}>
              {done.items.map(it => (
                <div key={it.contract} className="flex items-center justify-between text-xs">
                  <span style={{ color: 'var(--text-secondary)' }}>{fmtToken(it.balance)} {it.symbol}</span>
                  <span className="font-mono" style={{ color: 'var(--text-primary)' }}>→ {fmtMUSD(it.estimatedMUSD)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 mt-1 text-sm font-semibold" style={{ borderTop: '1px solid var(--border-base)' }}>
                <span style={{ color: 'var(--text-primary)' }}>Total</span>
                <span style={{ color: '#a78bfa' }}>{fmtMUSD(done.totalMUSD)}</span>
              </div>
              <p className="text-[11px] pt-1" style={{ color: 'var(--text-muted)' }}>
                {done.schedule === 'month_end' ? `Scheduled for ${fmtDate(done.scheduledFor)}` : 'Scheduled immediately'}
              </p>
            </div>
            <button onClick={load} className="btn-ghost mt-4" style={{ fontSize: 13, color: 'var(--accent)' }}>
              ← Back to balances
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty */}
      {!loading && !error && !done && preview && preview.tokens.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <Coins className="h-6 w-6" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>No tokens to consolidate</p>
          <p className="text-xs max-w-xs" style={{ color: 'var(--text-muted)' }}>
            This wallet holds no non-MUSD tokens. Once it does, you can roll them into MUSD here.
          </p>
        </div>
      )}

      {/* Token grid + actions */}
      {!loading && !error && !done && preview && preview.tokens.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {preview.tokens.map(t => {
              const isSel = t.priceAvailable && !excluded.has(t.contract);
              return (
                <button key={t.contract} onClick={() => toggle(t)} disabled={!t.priceAvailable}
                  className="flex items-center gap-3 rounded-xl p-3 text-left transition-colors disabled:cursor-not-allowed"
                  style={{
                    background: isSel ? 'rgba(167,139,250,0.08)' : 'var(--bg-raised)',
                    border: `1px solid ${isSel ? 'rgba(167,139,250,0.32)' : 'var(--border-base)'}`,
                    opacity: t.priceAvailable ? 1 : 0.55,
                  }}>
                  <TokenIcon token={t} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{t.symbol}</span>
                      {t.isNative && <span className="text-[9px] px-1 rounded" style={{ background: 'var(--bg-card)', color: 'var(--text-muted)' }}>native</span>}
                    </div>
                    <div className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                      {fmtToken(t.balance)} {t.symbol}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {t.priceAvailable ? (
                      <>
                        <div className="text-sm font-semibold" style={{ color: isSel ? '#a78bfa' : 'var(--text-secondary)' }}>
                          {fmtMUSD(t.estimatedMUSD)}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>≈ {fmtUSD(t.estimatedMUSD)}</div>
                      </>
                    ) : (
                      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>no price</div>
                    )}
                  </div>
                  {/* checkbox */}
                  <div className="h-4 w-4 rounded-[5px] flex items-center justify-center shrink-0"
                    style={{ background: isSel ? '#a78bfa' : 'transparent', border: `1.5px solid ${isSel ? '#a78bfa' : 'var(--border-hi, var(--border-base))'}` }}>
                    {isSel && <CheckCircle2 className="h-3 w-3" style={{ color: '#000' }} />}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Total + CTAs */}
          <div className="mt-5 flex flex-col gap-3">
            <div className="flex items-center justify-between rounded-xl px-4 py-3"
              style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-base)' }}>
              <span className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
                Est. total after consolidation
              </span>
              <span className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: '#a78bfa' }}>
                {fmtMUSD(totalSelectedMUSD)}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button onClick={() => execute('now')} disabled={selected.length === 0 || submitting !== null}
                className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
                style={{ background: '#a78bfa', color: '#000' }}>
                {submitting === 'now' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Consolidate Now
              </button>
              <button onClick={() => execute('month_end')} disabled={selected.length === 0 || submitting !== null}
                className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
                style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }}>
                {submitting === 'month_end' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
                Schedule for Month End
              </button>
            </div>
            <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>
              {selected.length} token{selected.length === 1 ? '' : 's'} selected ·{' '}
              {mode === 'safe' ? 'each swap needs your approval' : 'auto-executes under your cap'}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
