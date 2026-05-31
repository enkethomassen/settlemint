'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount, useSignMessage } from 'wagmi';
import {
  ShieldCheck, ExternalLink, CheckCircle2, Clock, AlertCircle, Fingerprint,
} from 'lucide-react';

const E: [number, number, number, number] = [0.22, 1, 0.36, 1];

const PASSPORT_URL = 'https://passport.mezo.org';

interface PassportStatus {
  verified: boolean;
  level: 'none' | 'basic' | 'advanced' | 'full';
  completedAt?: string;
}

const LEVEL_INFO = {
  none:     { label: 'Not verified',    color: 'var(--text-muted)',  bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)' },
  basic:    { label: 'Basic',           color: '#F7931A',            bg: 'rgba(247,147,26,0.08)',  border: 'rgba(247,147,26,0.22)' },
  advanced: { label: 'Advanced',        color: '#00d4aa',            bg: 'rgba(0,212,170,0.08)',   border: 'rgba(0,212,170,0.22)'  },
  full:     { label: 'Full Passport',   color: '#8b5cf6',            bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.22)'  },
};

function PassportBadge({ level }: { level: PassportStatus['level'] }) {
  const info = LEVEL_INFO[level];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
      style={{ background: info.bg, color: info.color, border: `1px solid ${info.border}` }}>
      {level !== 'none' && <CheckCircle2 className="h-3 w-3" />}
      {info.label}
    </span>
  );
}

export default function MezoPassport() {
  const { address, isConnected } = useAccount();
  const { signMessage } = useSignMessage();

  const [status, setStatus] = useState<PassportStatus>({ verified: false, level: 'none' });
  const [checking, setChecking] = useState(false);
  const [signing, setSigning] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');

  const checkPassport = async () => {
    if (!address) return;
    setChecking(true);
    setError('');
    try {
      // In production this would call the Mezo Passport API.
      // For hackathon demo, we simulate a check.
      await new Promise(r => setTimeout(r, 900));
      // Demo: wallets starting with 0x1 get "basic" passport
      const level = address.toLowerCase().startsWith('0x1')
        ? 'basic'
        : address.toLowerCase().startsWith('0xa')
          ? 'advanced'
          : 'none';
      setStatus({
        verified: level !== 'none',
        level: level as PassportStatus['level'],
        completedAt: level !== 'none' ? new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : undefined,
      });
      if (level !== 'none') setVerified(true);
    } catch {
      setError('Could not reach Mezo Passport service.');
    } finally {
      setChecking(false);
    }
  };

  const requestVerification = () => {
    if (!address) return;
    setSigning(true);
    signMessage(
      { message: `I am verifying my Mezo Passport for address ${address} at ${new Date().toISOString()}` },
      {
        onSuccess: () => {
          setSigning(false);
          // Open Mezo Passport in a new tab
          window.open(`${PASSPORT_URL}?address=${address}`, '_blank');
        },
        onError: () => {
          setSigning(false);
          setError('Signature cancelled.');
        },
      }
    );
  };

  if (!isConnected) {
    return (
      <div className="card-base p-8 flex items-center justify-center gap-3"
        style={{ color: 'var(--text-muted)' }}>
        <Fingerprint className="h-5 w-5" />
        <p className="text-[14px]">Connect wallet to check Mezo Passport</p>
      </div>
    );
  }

  return (
    <div className="card-base p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(247,147,26,0.10)', border: '1px solid rgba(247,147,26,0.22)' }}>
          <Fingerprint className="h-5 w-5" style={{ color: '#F7931A' }} />
        </div>
        <div>
          <h3 className="font-bold text-[15px]" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
            Mezo Passport
          </h3>
          <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            On-chain identity verification on Mezo network
          </p>
        </div>
        <div className="ml-auto">
          <PassportBadge level={status.level} />
        </div>
      </div>

      {/* What is Mezo Passport */}
      <div className="rounded-[14px] p-4"
        style={{ background: 'var(--bg-raised)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="text-[12.5px] leading-[1.8]" style={{ color: 'var(--text-secondary)' }}>
          Mezo Passport is an on-chain identity layer for the Mezo Bitcoin L2. Verified users unlock
          higher vault collateral ratios, reduced fees, and can participate in governance — all
          without giving up custody of funds.
        </p>
        <div className="flex flex-wrap gap-3 mt-3">
          {[
            { label: 'Higher collateral ratio',  color: '#F7931A' },
            { label: 'Lower protocol fees',      color: '#00d4aa' },
            { label: 'Governance participation', color: '#8b5cf6' },
            { label: 'Priority support',         color: '#22c55e' },
          ].map(({ label, color }) => (
            <span key={label} className="inline-flex items-center gap-1.5 text-[11px] font-medium"
              style={{ color }}>
              <span className="h-1 w-1 rounded-full" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Status */}
      <AnimatePresence>
        {verified && status.level !== 'none' && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 rounded-[14px] p-4"
            style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.18)' }}>
            <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: '#22c55e' }} />
            <div>
              <p className="text-[13px] font-semibold" style={{ color: '#22c55e' }}>
                Passport {LEVEL_INFO[status.level].label} verified
              </p>
              {status.completedAt && (
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Verified {status.completedAt}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2 rounded-[14px] p-3 text-[12.5px]"
            style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', color: '#ef4444' }}>
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={checkPassport}
          disabled={checking}
          className="btn-secondary flex items-center gap-2"
          style={{ fontSize: 13, padding: '9px 18px' }}>
          {checking ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          ) : <Clock className="h-3.5 w-3.5" />}
          {checking ? 'Checking…' : 'Check status'}
        </button>

        {status.level === 'none' && (
          <button
            onClick={requestVerification}
            disabled={signing}
            className="btn-primary flex items-center gap-2"
            style={{ fontSize: 13, padding: '9px 18px' }}>
            {signing ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            ) : <ShieldCheck className="h-3.5 w-3.5" />}
            {signing ? 'Signing…' : 'Verify with Mezo Passport'}
          </button>
        )}

        <a href={PASSPORT_URL} target="_blank" rel="noreferrer"
          className="btn-ghost inline-flex items-center gap-1.5"
          style={{ fontSize: 13, padding: '9px 18px' }}>
          <ExternalLink className="h-3.5 w-3.5" />
          Open Passport
        </a>
      </div>

      <p className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
        Mezo Passport verification is optional and non-custodial. No funds are moved during verification.
      </p>
    </div>
  );
}
