'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck, Bot, Zap, AlertTriangle, CheckCircle2,
  Lock, Unlock, ChevronRight, RefreshCw, Info,
} from 'lucide-react';
import { useAccount } from 'wagmi';
import { agentApi, type AgentSettings, formatMUSD } from '@/lib/api';

const E: [number, number, number, number] = [0.22, 1, 0.36, 1];

const CAP_PRESETS = [100, 500, 1000, 2500, 5000, 10000];

function formatDate(unix: number) {
  return new Date(unix * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function CapProgress({ used, cap, pct }: { used: number; cap: number; pct: number }) {
  const color = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : '#22c55e';
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          Monthly usage
        </span>
        <span className="text-[12px] font-mono font-bold" style={{ color }}>
          {formatMUSD(used)} / {formatMUSD(cap)} MUSD
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, pct)}%` }}
          transition={{ duration: 0.8, ease: E }}
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}cc, ${color})`, boxShadow: `0 0 10px ${color}55` }}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{pct.toFixed(1)}% used</span>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {formatMUSD(Math.max(0, cap - used))} remaining
        </span>
      </div>
    </div>
  );
}

function ModeCard({
  mode, selected, onClick,
}: {
  mode: 'safe' | 'autopilot';
  selected: boolean;
  onClick: () => void;
}) {
  const isSafe = mode === 'safe';
  const accent = isSafe ? '#00d4aa' : '#F7931A';

  return (
    <motion.button
      whileHover={{ y: -2, transition: { duration: 0.18, ease: E } }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="relative w-full text-left rounded-[18px] p-6 transition-all"
      style={{
        background: selected ? `${accent}0d` : 'var(--bg-raised)',
        border: `1.5px solid ${selected ? `${accent}44` : 'rgba(255,255,255,0.07)'}`,
        boxShadow: selected ? `0 0 24px ${accent}14` : 'none',
      }}
    >
      {selected && (
        <div className="absolute inset-x-0 top-0 h-px rounded-t-[18px]"
          style={{ background: `linear-gradient(90deg, transparent 10%, ${accent}66 50%, transparent 90%)` }} />
      )}

      <div className="flex items-start gap-4">
        <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `${accent}14`, border: `1px solid ${accent}28` }}>
          {isSafe
            ? <ShieldCheck className="h-5 w-5" style={{ color: accent }} />
            : <Bot className="h-5 w-5" style={{ color: accent }} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-bold text-[15px]" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
              {isSafe ? 'Safe Mode' : 'Autopilot'}
            </p>
            {selected && (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                style={{ background: `${accent}14`, color: accent, border: `1px solid ${accent}28` }}>
                <CheckCircle2 className="h-2.5 w-2.5" />
                Active
              </span>
            )}
          </div>
          <p className="text-[13px] leading-[1.7]" style={{ color: 'var(--text-secondary)' }}>
            {isSafe
              ? 'Agent queues payments. You approve each one via Telegram, WhatsApp, or this dashboard.'
              : 'Agent executes payments automatically within your monthly MUSD spending cap. Cap is hard-enforced.'}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {(isSafe
              ? ['Full approval control', 'Zero auto-spend', 'Multi-platform alerts']
              : ['Auto-executes within cap', 'Monthly cap enforced', 'Instant notifications']
            ).map(f => (
              <span key={f} className="inline-flex items-center gap-1.5 text-[11px] font-medium"
                style={{ color: selected ? accent : 'var(--text-muted)' }}>
                <span className="h-1 w-1 rounded-full" style={{ background: selected ? accent : 'var(--text-muted)', opacity: 0.7 }} />
                {f}
              </span>
            ))}
          </div>
        </div>

        <div className="shrink-0 mt-0.5">
          <div className="w-5 h-5 rounded-full flex items-center justify-center"
            style={{
              border: `2px solid ${selected ? accent : 'rgba(255,255,255,0.2)'}`,
              background: selected ? accent : 'transparent',
            }}>
            {selected && <div className="w-2 h-2 rounded-full bg-white" />}
          </div>
        </div>
      </div>
    </motion.button>
  );
}

export default function AgentSettingsPanel() {
  const { address } = useAccount();
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [localMode, setLocalMode] = useState<'safe' | 'autopilot'>('safe');
  const [localCap, setLocalCap] = useState(500);
  const [capInput, setCapInput] = useState('500');
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError('');
    try {
      const s = await agentApi.getSettings(address);
      setSettings(s);
      setLocalMode(s.mode);
      setLocalCap(s.spendingCap || 500);
      setCapInput(String(s.spendingCap || 500));
    } catch {
      setError('Could not load settings. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!address) return;
    setSaving(true);
    setError('');
    try {
      const cap = parseFloat(capInput);
      const s = await agentApi.updateSettings(address, localMode, isNaN(cap) ? localCap : cap);
      setSettings(s);
      setLocalMode(s.mode);
      setLocalCap(s.spendingCap);
      setCapInput(String(s.spendingCap));
      setDirty(false);
      setSuccess('Settings saved.');
      setTimeout(() => setSuccess(''), 3000);
    } catch {
      setError('Failed to save settings. Check backend.');
    } finally {
      setSaving(false);
    }
  };

  const changeMode = (m: 'safe' | 'autopilot') => {
    setLocalMode(m);
    setDirty(true);
  };

  const changeCap = (v: string) => {
    setCapInput(v);
    const n = parseFloat(v);
    if (!isNaN(n) && n >= 0) setLocalCap(n);
    setDirty(true);
  };

  if (!address) {
    return (
      <div className="card-base p-8 text-center">
        <Lock className="h-8 w-8 mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
        <p style={{ color: 'var(--text-secondary)' }}>Connect wallet to manage agent settings</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.04em', fontSize: '1.5rem' }}>
            Agent Policy
          </h2>
          <p className="mt-1" style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            Control how the automation agent handles your MUSD payments.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="btn-icon" style={{ width: 36, height: 36 }}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── Feedback ── */}
      <AnimatePresence>
        {(error || success) && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="flex items-center gap-3 rounded-[var(--r-lg)] px-5 py-3.5 text-sm font-semibold"
            style={error
              ? { background: 'var(--red-dim)', border: '1px solid var(--red-border)', color: 'var(--red)' }
              : { background: 'var(--green-dim)', border: '1px solid var(--green-border)', color: 'var(--green)' }}>
            {error ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
            {error || success}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Mode Selection ── */}
      <div className="card-base p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] mb-5"
          style={{ color: 'var(--text-muted)' }}>
          Operating Mode
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <ModeCard mode="safe"      selected={localMode === 'safe'}      onClick={() => changeMode('safe')} />
          <ModeCard mode="autopilot" selected={localMode === 'autopilot'} onClick={() => changeMode('autopilot')} />
        </div>
      </div>

      {/* ── Spending Cap ── */}
      <AnimatePresence>
        {localMode === 'autopilot' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.28, ease: E }}
            style={{ overflow: 'hidden' }}>
            <div className="card-base p-6 space-y-6">
              <div className="flex items-center gap-2">
                <Unlock className="h-4 w-4" style={{ color: '#F7931A' }} />
                <p className="text-[11px] font-bold uppercase tracking-[0.24em]"
                  style={{ color: 'var(--text-muted)' }}>
                  Monthly Spending Cap
                </p>
                <div className="group relative ml-auto">
                  <Info className="h-3.5 w-3.5 cursor-help" style={{ color: 'var(--text-muted)' }} />
                  <div className="pointer-events-none absolute right-0 top-5 z-50 w-56 rounded-xl p-3 text-[11px] leading-[1.7] opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.10)', color: 'var(--text-secondary)' }}>
                    Agent will not execute any payment that would push total MUSD spent this month over this cap. Hard-enforced — no overrides.
                  </div>
                </div>
              </div>

              {/* Cap input */}
              <div>
                <label className="block text-[12px] font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Cap amount (MUSD / month)
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex-1 flex items-center gap-2 rounded-[var(--r-md)] px-4 py-3"
                    style={{ background: 'var(--bg-raised)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <span className="text-[13px] font-mono font-bold" style={{ color: 'var(--text-muted)' }}>MUSD</span>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={capInput}
                      onChange={e => changeCap(e.target.value)}
                      className="flex-1 bg-transparent outline-none text-[15px] font-mono font-bold text-right"
                      style={{ color: 'var(--text-primary)' }}
                    />
                  </div>
                </div>

                {/* Slider */}
                <div className="mt-4">
                  <input
                    type="range"
                    min="0"
                    max="10000"
                    step="100"
                    value={parseFloat(capInput) || 0}
                    onChange={e => changeCap(e.target.value)}
                    className="w-full"
                    style={{ accentColor: '#F7931A' }}
                  />
                  <div className="flex justify-between mt-1">
                    {CAP_PRESETS.map(p => (
                      <button key={p}
                        onClick={() => changeCap(String(p))}
                        className="text-[10px] font-mono px-2 py-1 rounded-md transition-colors"
                        style={{
                          color: parseFloat(capInput) === p ? '#F7931A' : 'var(--text-muted)',
                          background: parseFloat(capInput) === p ? 'rgba(247,147,26,0.10)' : 'transparent',
                        }}>
                        {p >= 1000 ? `${p / 1000}k` : p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Usage progress */}
              {settings && settings.spendingCap > 0 && (
                <CapProgress
                  used={settings.spendingUsed}
                  cap={settings.spendingCap}
                  pct={settings.capUsedPct}
                />
              )}

              {/* Reset date */}
              {settings && settings.spendingReset > 0 && (
                <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  <RefreshCw className="h-3 w-3" />
                  Cap resets {formatDate(settings.spendingReset)}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Security notice ── */}
      <div className="flex items-start gap-4 rounded-[16px] p-5"
        style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)' }}>
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.22)' }}>
          <ShieldCheck className="h-4 w-4" style={{ color: '#22c55e' }} />
        </div>
        <div>
          <p className="font-semibold text-[13px] mb-1" style={{ color: '#22c55e' }}>Non-custodial guarantee</p>
          <p className="text-[12.5px] leading-[1.8]" style={{ color: 'var(--text-secondary)' }}>
            The agent only executes payments you pre-approved via the payment scheduler.
            It never has unrestricted access to your vault. Spending caps are enforced in software
            before any transaction is submitted.
          </p>
        </div>
      </div>

      {/* ── Connector info ── */}
      <div className="card-base p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] mb-4" style={{ color: 'var(--text-muted)' }}>
          Bot Integrations
        </p>
        <div className="space-y-3">
          {[
            { name: 'Telegram Bot', cmd: '/safe or /autopilot', desc: 'Set mode and cap directly in chat', color: '#229ed9' },
            { name: 'WhatsApp Bot', cmd: 'safe or autopilot', desc: 'Text commands to update policy', color: '#25D366' },
          ].map(({ name, cmd, desc, color }) => (
            <div key={name} className="flex items-center gap-4 rounded-xl px-4 py-3"
              style={{ background: 'var(--bg-raised)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: `${color}14`, border: `1px solid ${color}28` }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{name}</p>
                <p className="text-[11px] font-mono mt-0.5" style={{ color }}>
                  {cmd}
                </p>
              </div>
              <p className="text-[11.5px] hidden sm:block" style={{ color: 'var(--text-muted)' }}>{desc}</p>
              <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
            </div>
          ))}
        </div>
        <p className="text-[11px] mt-3" style={{ color: 'var(--text-muted)' }}>
          Changes here sync with bot settings automatically — same database.
        </p>
      </div>

      {/* ── Save ── */}
      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
            className="flex items-center justify-between rounded-[var(--r-lg)] px-5 py-4"
            style={{ background: 'rgba(247,147,26,0.08)', border: '1px solid rgba(247,147,26,0.22)' }}>
            <div className="flex items-center gap-2.5">
              <Zap className="h-4 w-4" style={{ color: '#F7931A' }} />
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                Unsaved changes
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setDirty(false); if (settings) { setLocalMode(settings.mode); setLocalCap(settings.spendingCap); setCapInput(String(settings.spendingCap)); } }}
                className="btn-ghost" style={{ padding: '8px 16px', fontSize: 13 }}>
                Discard
              </button>
              <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ padding: '8px 20px', fontSize: 13 }}>
                {saving ? 'Saving…' : 'Save Policy'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
