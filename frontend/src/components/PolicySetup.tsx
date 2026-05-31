'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount } from 'wagmi';
import {
  Plus, Trash2, CheckCircle2, AlertTriangle, Globe, Wallet,
  RefreshCw, Clock, Shield, ChevronDown, ChevronUp,
} from 'lucide-react';
import { apiExtra, INTERVAL_OPTIONS, formatInterval, formatMUSD, shortenAddress } from '@/lib/api';
import { useVault } from '@/hooks/useVault';

const E: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface PolicyDraft {
  label: string;
  type: 'wallet' | 'x402';
  recipient: string;
  amount: string;
  interval: number;
  requireApproval: boolean;
}

const EMPTY_DRAFT: PolicyDraft = {
  label: '', type: 'wallet', recipient: '', amount: '', interval: 2592000, requireApproval: false,
};

function PolicyCard({ payment, onCancel }: {
  payment: { id: number; recipient: string; amount: string; interval: number; isActive: boolean; isX402: boolean; endpoint: string; nextExecution: string };
  onCancel: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const { address } = useAccount();

  const handleCancel = async () => {
    if (!address) return;
    setCancelling(true);
    try {
      await apiExtra.cancelPayment(address, payment.id);
      onCancel(payment.id);
    } catch {
      setCancelling(false);
    }
  };

  const dest = payment.isX402 ? payment.endpoint : payment.recipient;
  const shortDest = payment.isX402
    ? dest.slice(0, 28) + '…'
    : shortenAddress(dest);

  return (
    <motion.div
      layout
      className="rounded-[16px] overflow-hidden"
      style={{ background: 'var(--bg-raised)', border: `1px solid ${payment.isActive ? 'rgba(247,147,26,0.16)' : 'rgba(255,255,255,0.06)'}` }}>

      {/* Main row */}
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: payment.isX402 ? 'rgba(139,92,246,0.12)' : 'rgba(247,147,26,0.10)', border: `1px solid ${payment.isX402 ? 'rgba(139,92,246,0.24)' : 'rgba(247,147,26,0.22)'}` }}>
          {payment.isX402
            ? <Globe className="h-4 w-4" style={{ color: '#8b5cf6' }} />
            : <Wallet className="h-4 w-4" style={{ color: '#F7931A' }} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-[14px]" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
              {formatMUSD(payment.amount)} MUSD
            </span>
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              / {formatInterval(payment.interval)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
              style={{
                background: payment.isActive ? 'rgba(34,197,94,0.10)' : 'rgba(255,255,255,0.05)',
                color: payment.isActive ? '#22c55e' : 'var(--text-muted)',
                border: `1px solid ${payment.isActive ? 'rgba(34,197,94,0.24)' : 'rgba(255,255,255,0.08)'}`,
              }}>
              {payment.isActive ? '● Active' : 'Cancelled'}
            </span>
            {payment.isX402 && (
              <span className="text-[10px] font-bold rounded-full px-2 py-0.5"
                style={{ background: 'rgba(139,92,246,0.10)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.22)' }}>
                x402
              </span>
            )}
          </div>
          <p className="text-[12px] font-mono mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
            → {shortDest}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right hidden sm:block">
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Next run</p>
            <p className="text-[12px] font-semibold" style={{ color: payment.isActive ? '#22c55e' : 'var(--text-muted)' }}>
              {payment.isActive ? payment.nextExecution : '—'}
            </p>
          </div>

          {payment.isActive && (
            <button onClick={handleCancel} disabled={cancelling}
              className="btn-icon"
              style={{ width: 30, height: 30, color: cancelling ? 'var(--text-muted)' : '#ef4444' }}
              title="Cancel policy">
              {cancelling
                ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          )}

          <button onClick={() => setExpanded(v => !v)} className="btn-icon" style={{ width: 30, height: 30 }}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            transition={{ duration: 0.22, ease: E }} style={{ overflow: 'hidden' }}>
            <div className="px-5 pb-4 pt-1 grid grid-cols-2 sm:grid-cols-3 gap-3 border-t"
              style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              {[
                { label: 'Payment ID', value: `#${payment.id}` },
                { label: 'Type', value: payment.isX402 ? 'x402 API' : 'Wallet transfer' },
                { label: 'Interval', value: formatInterval(payment.interval) },
                { label: 'Destination', value: shortDest },
                { label: 'Amount', value: `${formatMUSD(payment.amount)} MUSD` },
                { label: 'Status', value: payment.isActive ? 'Active' : 'Cancelled' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] mb-1" style={{ color: 'var(--text-muted)' }}>
                    {label}
                  </p>
                  <p className="text-[12.5px] font-mono" style={{ color: 'var(--text-secondary)' }}>{value}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CreatePolicyForm({ onSuccess }: { onSuccess: () => void }) {
  const { address } = useAccount();
  const [draft, setDraft] = useState<PolicyDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof PolicyDraft, v: any) => setDraft(d => ({ ...d, [k]: v }));

  const handleSubmit = async () => {
    if (!address) return;
    if (!draft.amount || isNaN(parseFloat(draft.amount))) {
      setError('Enter a valid MUSD amount'); return;
    }
    if (draft.type === 'wallet' && !draft.recipient.startsWith('0x')) {
      setError('Enter a valid EVM wallet address'); return;
    }
    if (draft.type === 'x402' && !draft.recipient.startsWith('http')) {
      setError('Enter a valid x402 endpoint URL (https://…)'); return;
    }
    setSaving(true);
    setError('');
    try {
      await apiExtra.createPayment({
        address,
        recipient: draft.type === 'wallet' ? draft.recipient : undefined,
        amount: draft.amount,
        interval: draft.interval,
        isX402: draft.type === 'x402',
        endpoint: draft.type === 'x402' ? draft.recipient : undefined,
      });
      setDraft(EMPTY_DRAFT);
      onSuccess();
    } catch (e: any) {
      setError(e.message || 'Failed to create policy');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Type toggle */}
      <div className="grid grid-cols-2 gap-3">
        {(['wallet', 'x402'] as const).map(t => (
          <button key={t} onClick={() => set('type', t)}
            className="flex items-center gap-2.5 rounded-[14px] px-4 py-3 text-left transition-all"
            style={{
              background: draft.type === t ? (t === 'wallet' ? 'rgba(247,147,26,0.08)' : 'rgba(139,92,246,0.08)') : 'var(--bg-raised)',
              border: `1.5px solid ${draft.type === t ? (t === 'wallet' ? 'rgba(247,147,26,0.36)' : 'rgba(139,92,246,0.36)') : 'rgba(255,255,255,0.08)'}`,
            }}>
            {t === 'wallet'
              ? <Wallet className="h-4 w-4" style={{ color: draft.type === 'wallet' ? '#F7931A' : 'var(--text-muted)' }} />
              : <Globe className="h-4 w-4" style={{ color: draft.type === 'x402' ? '#8b5cf6' : 'var(--text-muted)' }} />}
            <div>
              <p className="font-semibold text-[13px]" style={{ color: 'var(--text-primary)' }}>
                {t === 'wallet' ? 'Wallet Transfer' : 'x402 API'}
              </p>
              <p className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
                {t === 'wallet' ? 'Send MUSD to a wallet' : 'Pay-per-request endpoint'}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Recipient */}
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-[0.18em] mb-2" style={{ color: 'var(--text-muted)' }}>
          {draft.type === 'wallet' ? 'Recipient address' : 'x402 endpoint URL'}
        </label>
        <input
          value={draft.recipient}
          onChange={e => set('recipient', e.target.value)}
          placeholder={draft.type === 'wallet' ? '0x…' : 'https://api.example.com/premium'}
          className="w-full rounded-[var(--r-md)] px-4 py-3 text-[13px] font-mono outline-none"
          style={{ background: 'var(--bg-raised)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-primary)' }}
        />
      </div>

      {/* Amount + interval */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-[0.18em] mb-2" style={{ color: 'var(--text-muted)' }}>
            Amount (MUSD)
          </label>
          <input
            type="number" min="0.01" step="0.01"
            value={draft.amount}
            onChange={e => set('amount', e.target.value)}
            placeholder="100"
            className="w-full rounded-[var(--r-md)] px-4 py-3 text-[13px] font-mono outline-none"
            style={{ background: 'var(--bg-raised)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-primary)' }}
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-[0.18em] mb-2" style={{ color: 'var(--text-muted)' }}>
            Frequency
          </label>
          <select
            value={draft.interval}
            onChange={e => set('interval', Number(e.target.value))}
            className="w-full rounded-[var(--r-md)] px-4 py-3 text-[13px] outline-none"
            style={{ background: 'var(--bg-raised)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-primary)' }}>
            {INTERVAL_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Approval toggle */}
      <div className="flex items-center justify-between rounded-[14px] px-4 py-3"
        style={{ background: 'var(--bg-raised)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-2.5">
          <Shield className="h-4 w-4" style={{ color: draft.requireApproval ? '#00d4aa' : 'var(--text-muted)' }} />
          <div>
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Require approval</p>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Route through Safe mode before each execution</p>
          </div>
        </div>
        <button onClick={() => set('requireApproval', !draft.requireApproval)}
          className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0"
          style={{ background: draft.requireApproval ? '#00d4aa' : 'rgba(255,255,255,0.10)' }}>
          <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
            style={{ transform: `translateX(${draft.requireApproval ? '20px' : '0'})` }} />
        </button>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2 rounded-[12px] px-4 py-3 text-[12.5px]"
            style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', color: '#ef4444' }}>
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <button onClick={handleSubmit} disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2"
        style={{ padding: '12px', fontSize: 14 }}>
        {saving
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          : <Plus className="h-4 w-4" />}
        {saving ? 'Creating…' : 'Create Payment Policy'}
      </button>
    </div>
  );
}

export default function PolicySetup() {
  const { address } = useAccount();
  const { payments, refetch, isLoading } = useVault();
  const [creating, setCreating] = useState(false);
  const [success, setSuccess] = useState('');

  const handleSuccess = () => {
    setCreating(false);
    setSuccess('Policy created successfully.');
    refetch();
    setTimeout(() => setSuccess(''), 4000);
  };

  const handleCancel = (_id: number) => { refetch(); };

  if (!address) {
    return (
      <div className="card-base p-8 text-center">
        <Clock className="h-8 w-8 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
        <p style={{ color: 'var(--text-secondary)' }}>Connect wallet to manage payment policies</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.04em', fontSize: '1.5rem' }}>
            Payment Policies
          </h2>
          <p className="mt-1" style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            {payments.filter(p => p.isActive).length} active · {payments.length} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="btn-icon" style={{ width: 36, height: 36 }}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setCreating(v => !v)} className="btn-primary flex items-center gap-2"
            style={{ padding: '9px 18px', fontSize: 13 }}>
            {creating ? 'Cancel' : <><Plus className="h-3.5 w-3.5" /> New Policy</>}
          </button>
        </div>
      </div>

      {/* Success */}
      <AnimatePresence>
        {success && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2 rounded-[var(--r-lg)] px-5 py-3.5 text-sm font-semibold"
            style={{ background: 'var(--green-dim)', border: '1px solid var(--green-border)', color: 'var(--green)' }}>
            <CheckCircle2 size={14} /> {success}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create form */}
      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.26, ease: E }}
            style={{ overflow: 'hidden' }}>
            <div className="card-base p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] mb-5" style={{ color: 'var(--text-muted)' }}>
                New Payment Policy
              </p>
              <CreatePolicyForm onSuccess={handleSuccess} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Policy list */}
      {payments.length === 0 ? (
        <div className="card-base p-10 text-center">
          <Clock className="h-8 w-8 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
          <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>No payment policies yet</p>
          <p className="text-[13px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Create your first policy to automate recurring MUSD payments.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {payments.map(p => (
            <PolicyCard key={p.id} payment={p} onCancel={handleCancel} />
          ))}
        </div>
      )}
    </div>
  );
}
