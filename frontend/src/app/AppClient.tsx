'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import {
  ArrowRight, ShieldCheck, Zap, BrainCircuit,
  LockKeyhole, Clock3, Eye, AlertTriangle, GitBranch,
  ShieldOff, CheckCircle2, XCircle, Bot, Plus, ChevronRight, FlaskConical,
} from 'lucide-react';
import WalletConnect from '@/components/WalletConnect';
import ThemeToggle from '@/components/ThemeToggle';
import NetworkToggle from '@/components/NetworkToggle';
import VaultStats from '@/components/VaultStats';
import PaymentList from '@/components/PaymentList';
import CreatePaymentForm from '@/components/CreatePaymentForm';
import SchedulerPanel from '@/components/SchedulerPanel';
import ExecutionLog from '@/components/ExecutionLog';
import DepositPanel from '@/components/DepositPanel';
import YieldPanel from '@/components/YieldPanel';
import CashflowTimeline from '@/components/CashflowTimeline';
import X402Monitor from '@/components/X402Monitor';
import InsightsFeed from '@/components/InsightsFeed';
import AgentSettingsPanel from '@/components/AgentSettingsPanel';
import CashflowForecast from '@/components/CashflowForecast';
import MezoPassport from '@/components/MezoPassport';
import PolicySetup from '@/components/PolicySetup';
import PriceTicker from '@/components/PriceTicker';
import MyTransactions from '@/components/MyTransactions';
import ConsolidationCard from '@/components/ConsolidationCard';
import WalletAnalysisView from '@/components/WalletAnalysisView';
import PredictedPaymentsView from '@/components/PredictedPaymentsView';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { useVault } from '@/hooks/useVault';
import { api, walletApi, type SchedulerStatus, type PaymentStats, type ExecutionLogEntry, type WalletAnalysis } from '@/lib/api';
import { useNetwork } from '@/context/network-context';
import type { Tab } from '@/components/types';
import { BitstreamFlowAnimation } from '@/components/landing/BitstreamFlowAnimation';

// ── Easing constants (Impeccable / ACE system) ─────────────
const E: [number, number, number, number] = [0.16, 1, 0.3, 1];
const EC: [number, number, number, number] = [0.22, 1, 0.36, 1];

const upMount = (d = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.76, ease: E, delay: d },
});

// ── Scroll-triggered Reveal ─────────────────────────────────
function Reveal({ children, delay = 0, className = '' }: {
  children: React.ReactNode; delay?: number; className?: string;
}) {
  return (
    <motion.div className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-5%' }}
      transition={{ duration: 0.80, ease: E, delay }}
    >
      {children}
    </motion.div>
  );
}

// ── Official Bitstream Logo Mark ───────────────────────────
function LogoMark({ size = 40, bg = '#0b0b0b' }: { size?: number; bg?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="4,4 60,4 60,44 20,60 4,60" fill="#F7931A" />
      <rect x="13" y="13" width="22" height="22" rx="3" fill={bg} />
    </svg>
  );
}

function LogoWordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const cfg = {
    sm: { icon: 24, text: '15px', sub: '7.5px', gap: 9 },
    md: { icon: 34, text: '20px', sub: '8.5px', gap: 12 },
    lg: { icon: 44, text: '26px', sub: '9.5px', gap: 14 },
    xl: { icon: 60, text: '36px', sub: '11px',  gap: 18 },
  }[size];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: cfg.gap }}>
      <LogoMark size={cfg.icon} bg="#0b0b0b" />
      <div style={{ lineHeight: 1 }}>
        <div style={{ fontSize: cfg.text, fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '-0.04em', lineHeight: 1 }}>
          <span style={{ color: 'var(--text-primary)' }}>bit</span>
          <span style={{ color: '#F7931A' }}>stream</span>
        </div>
        <div style={{ fontSize: cfg.sub, fontWeight: 600, letterSpacing: '0.22em', marginTop: 5, textTransform: 'uppercase' as const, color: '#F7931A', opacity: 0.7 }}>
          Bitcoin Cashflow · Mezo
        </div>
      </div>
    </div>
  );
}

// ── Pain Card ───────────────────────────────────────────────
function PainCard({ icon: Icon, title, body, accent }: {
  icon: React.FC<any>; title: string; body: string; accent: string;
}) {
  return (
    <motion.div
      whileHover={{ y: -4, transition: { duration: 0.22, ease: E } }}
      className="group relative flex flex-col h-full rounded-[20px] p-7"
      style={{
        background: 'linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      }}
    >
      <div className="pointer-events-none absolute inset-0 rounded-[20px] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `radial-gradient(ellipse at 20% 0%, ${accent}18 0%, transparent 65%)` }} />
      <div className="absolute inset-x-0 top-0 h-px rounded-t-[20px] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}60, transparent)` }} />
      <div className="relative mb-5 flex h-11 w-11 items-center justify-center rounded-xl"
        style={{ background: `${accent}14`, border: `1px solid ${accent}28` }}>
        <Icon className="h-5 w-5" style={{ color: accent }} />
      </div>
      <h3 className="relative font-bold leading-snug mb-3"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.02em', fontSize: '1.05rem' }}>
        {title}
      </h3>
      <p className="relative text-[0.9rem] leading-[1.9]" style={{ color: 'var(--text-secondary)' }}>
        {body}
      </p>
    </motion.div>
  );
}

// ── Flow Step ───────────────────────────────────────────────
function FlowStep({ n, title, body, accent, last }: {
  n: string; title: string; body: string; accent: string; last?: boolean;
}) {
  return (
    <div className="relative flex gap-7">
      <div className="relative flex-shrink-0 flex flex-col items-center">
        <div className="relative flex h-12 w-12 items-center justify-center rounded-full z-10"
          style={{ background: `${accent}18`, border: `1.5px solid ${accent}44` }}>
          <span className="font-mono font-bold" style={{ color: accent, fontSize: '12px' }}>{n}</span>
        </div>
        {!last && (
          <div className="absolute top-12 left-1/2 w-px -translate-x-1/2"
            style={{ height: 'calc(100% + 28px)', background: `linear-gradient(180deg, ${accent}35, transparent)` }} />
        )}
      </div>
      <div className="pb-14 pt-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.26em] mb-3" style={{ color: accent }}>Step {n}</p>
        <h3 className="font-bold leading-snug mb-3"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.025em', fontSize: '1.2rem' }}>
          {title}
        </h3>
        <p className="text-[1rem] leading-[1.9]" style={{ color: 'var(--text-secondary)' }}>
          {body}
        </p>
      </div>
    </div>
  );
}

// ── Mode Card ───────────────────────────────────────────────
function ModeCard({ mode, label, headline, accent1, sub, features, featured }: {
  mode: 'safe' | 'auto'; label: string; headline: React.ReactNode;
  accent1: string; sub: string; features: { text: string; yes: boolean }[]; featured?: boolean;
}) {
  return (
    <motion.div
      whileHover={{ y: -3, transition: { duration: 0.2, ease: E } }}
      className="relative flex h-full flex-col rounded-[24px] p-9 lg:p-11"
      style={{
        background: featured ? `linear-gradient(145deg, ${accent1}10, var(--bg-card))` : 'var(--bg-card)',
        border: `1px solid ${featured ? `${accent1}30` : 'rgba(255,255,255,0.08)'}`,
        boxShadow: featured ? `0 8px 40px rgba(0,0,0,0.5), 0 0 80px ${accent1}10` : '0 4px 20px rgba(0,0,0,0.4)',
      }}
    >
      <div className="absolute inset-x-0 top-0 h-px rounded-t-[24px]"
        style={{ background: `linear-gradient(90deg, transparent 5%, ${accent1}55 50%, transparent 95%)` }} />
      <div className="mb-6 flex items-center justify-between">
        <div className="flex h-12 w-12 items-center justify-center rounded-[14px]"
          style={{ background: `${accent1}12`, border: `1px solid ${accent1}24` }}>
          {mode === 'safe'
            ? <ShieldCheck className="h-5 w-5" style={{ color: accent1 }} />
            : <Bot className="h-5 w-5" style={{ color: accent1 }} />}
        </div>
        {featured && (
          <span className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em]"
            style={{ background: `${accent1}14`, color: accent1, border: `1px solid ${accent1}28` }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent1 }} />
            Recommended
          </span>
        )}
      </div>
      <span className="label-eyebrow">{label}</span>
      <div className="mt-5 font-bold leading-[1.1] tracking-[-0.05em]"
        style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.6rem,2.2vw,2.0rem)', color: 'var(--text-primary)' }}>
        {headline}
      </div>
      <p className="mt-5 text-[1rem] leading-[1.9]" style={{ color: 'var(--text-secondary)' }}>{sub}</p>
      <div className="mt-8 flex-1 space-y-4">
        {features.map(({ text, yes }) => (
          <div key={text} className="flex items-start gap-3">
            {yes
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accent1 }} />
              : <XCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'rgba(255,255,255,0.2)' }} />}
            <span className="text-[0.93rem] leading-snug" style={{ color: yes ? 'var(--text-secondary)' : 'var(--text-muted)' }}>{text}</span>
          </div>
        ))}
      </div>
      <div className="mt-9 h-px rounded-full" style={{ background: `linear-gradient(90deg, ${accent1}50, transparent 70%)` }} />
    </motion.div>
  );
}

// ── Hero Stat ───────────────────────────────────────────────
function HeroStat({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <div className="font-bold leading-none tracking-[-0.06em]"
        style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem,3vw,2.8rem)', color: 'var(--text-primary)' }}>
        {n}
      </div>
      <div className="mt-2 text-[0.85rem] font-medium" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
    </div>
  );
}

// ── Section Label ───────────────────────────────────────────
function SectionLabel({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-center gap-3 mb-7">
      <span className="h-px w-10 rounded-full"
        style={{ background: accent ? 'rgba(255,0,64,0.5)' : 'rgba(255,255,255,0.15)' }} />
      <span className="text-[11px] font-bold uppercase tracking-[0.28em]"
        style={{ color: accent ? '#F7931A' : 'var(--text-muted)', opacity: accent ? 1 : 1 }}>
        {children}
      </span>
    </div>
  );
}

// ── Testnet Banner ──────────────────────────────────────────
function TestnetBanner() {
  const { network } = useNetwork();
  return (
    <AnimatePresence>
      {network === 'testnet' && (
        <motion.div key="testnet-banner"
          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: EC }}
          style={{ overflow: 'hidden' }}>
          <div className="flex items-center justify-center gap-2.5 px-4 py-2.5 text-[12px] font-semibold tracking-wide"
            style={{ background: 'rgba(139,92,246,0.08)', borderBottom: '1px solid rgba(139,92,246,0.2)', color: '#a78bfa' }}>
            <FlaskConical className="w-3.5 h-3.5 shrink-0" />
            Matsnet Testnet — balances and transactions are test data only. No real funds at risk.
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────
// APP SHELL (when connected)
// ─────────────────────────────────────────────────────────────
export default function AppClient() {
  const { address: walletAddress, isConnected } = useAccount();
  const { payments, refetch, isLoading, musdBalance } = useVault();

  const [tab, setTab]                         = useState<Tab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen]   = useState(false);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [paymentStats, setPaymentStats]       = useState<PaymentStats | null>(null);
  const [executionLog, setExecutionLog]       = useState<ExecutionLogEntry[]>([]);
  const [backendOnline, setBackendOnline]     = useState<boolean | null>(null);
  const [successMsg, setSuccessMsg]           = useState('');

  useEffect(() => {
    api.health().then(() => setBackendOnline(true)).catch(() => setBackendOnline(false));
  }, []);

  const fetchAgentData = useCallback(async () => {
    try {
      const [status, stats, log] = await Promise.all([
        api.getSchedulerStatus(), api.getPaymentStats(), api.getPaymentLog(),
      ]);
      setSchedulerStatus(status);
      setPaymentStats(stats);
      setExecutionLog(log.log);
    } catch {}
  }, []);

  useEffect(() => {
    if (!walletAddress) return;
    fetchAgentData();
    const id = setInterval(() => { refetch(); fetchAgentData(); }, 30_000);
    return () => clearInterval(id);
  }, [walletAddress, refetch, fetchAgentData]);

  const handleCreateSuccess = () => {
    setSuccessMsg('Payment scheduled successfully.');
    setTimeout(() => setSuccessMsg(''), 4000);
    setTab('payments');
  };

  const handleTrigger = async () => {
    await api.triggerScheduler();
    setTimeout(() => { refetch(); fetchAgentData(); }, 2000);
  };

  const navigate = (t: Tab) => { setTab(t); setMobileMenuOpen(false); };
  const onRefresh = () => { refetch(); fetchAgentData(); };

  if (!isConnected) return <LandingPage />;

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* ── Ambient mesh ── */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute" style={{ width: 900, height: 900, top: -350, right: -250,
          background: 'radial-gradient(ellipse, rgba(255,0,64,0.05) 0%, transparent 65%)', borderRadius: '50%' }} />
        <div className="absolute" style={{ width: 700, height: 700, bottom: -250, left: -200,
          background: 'radial-gradient(ellipse, rgba(247,147,26,0.04) 0%, transparent 65%)', borderRadius: '50%' }} />
      </div>

      <Sidebar tab={tab} onNavigate={navigate} backendOnline={backendOnline} isLoading={isLoading} onRefresh={onRefresh} />

      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }} className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              onClick={() => setMobileMenuOpen(false)} />
            <motion.div initial={{ x: -270 }} animate={{ x: 0 }} exit={{ x: -270 }}
              transition={{ type: 'spring', stiffness: 400, damping: 40 }}
              className="fixed left-0 top-0 z-50 lg:hidden" style={{ height: '100vh', width: 264 }}>
              <Sidebar tab={tab} onNavigate={navigate} backendOnline={backendOnline} isLoading={isLoading} onRefresh={onRefresh} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <Topbar tab={tab} onMenuToggle={() => setMobileMenuOpen(v => !v)} />
        <TestnetBanner />

        <main className="flex-1 overflow-auto" style={{ padding: 'clamp(24px, 3vw, 48px)' }}>
          <div className="max-w-5xl mx-auto">
            <AnimatePresence>
              {successMsg && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                  className="mb-6 flex items-center gap-3 px-5 py-4 rounded-[var(--r-lg)] text-sm font-semibold"
                  style={{ background: 'var(--green-dim)', border: '1px solid var(--green-border)', color: 'var(--green)' }}>
                  <Zap size={14} /> {successMsg}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              <motion.div key={tab}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: EC }}>
                {tab === 'dashboard' && <DashboardView payments={payments} log={executionLog} setTab={setTab} isLoading={isLoading} musdBalance={parseFloat(musdBalance) || 0} walletAddress={walletAddress} />}
                {tab === 'analyze' && <WalletAnalysisView />}
                {tab === 'predicted' && <PredictedPaymentsView />}
                {tab === 'vault' && (
                  <div className="max-w-xl space-y-6">
                    <SectionHead title="Vault Management" sub="Deposit BTC collateral and mint MUSD." />
                    <VaultStats />
                    <DepositPanel />
                  </div>
                )}
                {tab === 'create' && (
                  <div className="max-w-xl">
                    <SectionHead title="Schedule a Payment" sub="Set up a recurring MUSD payment to a wallet or x402 API endpoint." />
                    <div className="card-base p-7">
                      <CreatePaymentForm onSuccess={handleCreateSuccess} />
                    </div>
                  </div>
                )}
                {tab === 'payments' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <SectionHead
                        title="Payment Schedules"
                        sub={`${payments.filter(p => p.isActive).length} active · ${payments.length} total`}
                      />
                      <button onClick={() => setTab('create')} className="btn-primary" style={{ padding: '10px 20px', fontSize: 14 }}>
                        <Plus size={14} /> New
                      </button>
                    </div>
                    <div className="card-base p-6">
                      <PaymentList payments={payments} showCancelButton />
                    </div>
                  </div>
                )}
                {tab === 'yield' && <YieldPanel />}
                {tab === 'x402'  && <X402Monitor log={executionLog} stats={paymentStats} />}
                {tab === 'policies' && <PolicySetup />}
                {tab === 'settings' && (
                  <div className="space-y-6 max-w-3xl">
                    <AgentSettingsPanel />
                    <MezoPassport />
                  </div>
                )}
                {tab === 'agent' && (
                  <div className="space-y-6">
                    <SectionHead title="Automation Agent" sub="Scheduler runs every minute · executes due payments via contract or x402." />
                    <SchedulerPanel status={schedulerStatus} stats={paymentStats} onTrigger={handleTrigger} />
                    <div className="card-base p-6">
                      <div className="flex items-center justify-between mb-5">
                        <h3 className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>Full Execution Log</h3>
                        <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{executionLog.length} entries</span>
                      </div>
                      <ExecutionLog log={executionLog} />
                    </div>
                    <div className="card-base p-6">
                      <h3 className="text-[15px] font-bold mb-5" style={{ color: 'var(--text-primary)' }}>System Architecture</h3>
                      <div className="space-y-4 text-sm font-mono">
                        {[
                          { dot: 'var(--btc)',    label: 'Capital Layer',    desc: 'MUSDVault.sol · BTC collateral · MUSD minting' },
                          { dot: 'var(--accent)', label: 'Automation Layer', desc: 'scheduler.ts · paymentExecutor.ts · cron' },
                          { dot: 'var(--x402)',   label: 'Payment Layer',    desc: 'x402/client.ts · HTTP 402 · MUSD payments' },
                        ].map(layer => (
                          <div key={layer.label} className="flex items-center gap-4">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: layer.dot }} />
                            <span className="font-semibold w-40 text-[13px]" style={{ color: 'var(--text-primary)' }}>{layer.label}</span>
                            <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{layer.desc}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Section head helper ─────────────────────────────────────
function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-6">
      <h2 className="font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.035em', fontSize: '1.5rem' }}>
        {title}
      </h2>
      {sub && <p className="mt-1.5" style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{sub}</p>}
    </div>
  );
}

// ── Wallet cashflow summary fetched from live Mezo data ────
function useWalletSummary(address: string | undefined) {
  const [summary, setSummary] = useState<WalletAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    walletApi.analyze(address, 'evm', '30d')
      .then(d => setSummary(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [address]);

  return { summary, loading };
}

function WalletSummaryBar({ address, onFullAnalysis }: { address: string; onFullAnalysis: () => void }) {
  const { summary, loading } = useWalletSummary(address);

  if (loading) {
    return (
      <div className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)' }}>
        <div className="h-4 w-40 rounded animate-pulse" style={{ background: 'var(--bg-raised)' }} />
        <div className="grid grid-cols-3 gap-3">
          {[1,2,3].map(i => <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: 'var(--bg-raised)' }} />)}
        </div>
      </div>
    );
  }
  if (!summary) return null;

  const fmtUSD = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  const tokenBurnEntries = Object.entries(summary.monthlyBurnTokens ?? {}).filter(([, v]) => v > 0);
  const burnLabel = summary.monthlyBurn > 0
    ? fmtUSD(summary.monthlyBurn)
    : tokenBurnEntries.length > 0
      ? `${tokenBurnEntries[0][1].toFixed(2)} ${tokenBurnEntries[0][0]}`
      : '$0';

  const top = summary.topRecipients?.[0];
  const topLabel = top ? `${top.address.slice(0, 6)}…${top.address.slice(-4)}` : '—';

  // Rule-based insights from real data
  const insights: string[] = [];
  if (summary.monthlyBurn > 0 && summary.runway !== '∞')
    insights.push(`At current burn rate, runway is ${summary.runway}.`);
  if (summary.recurringPayments.length > 0)
    insights.push(`${summary.recurringPayments.length} recurring payment pattern${summary.recurringPayments.length > 1 ? 's' : ''} detected — good candidates to automate.`);
  if (summary.totalInflow > summary.totalOutflow && summary.totalInflow > 0)
    insights.push(`Net positive cashflow this period: +${fmtUSD(summary.totalInflow - summary.totalOutflow)}.`);
  if (top && top.totalUSD > 0)
    insights.push(`Largest recipient ${topLabel} received ${fmtUSD(top.totalUSD)} across ${top.count} transactions.`);
  if (summary.spendByCategory[0])
    insights.push(`Top spend category: ${summary.spendByCategory[0].category} at ${summary.spendByCategory[0].percentage}% of outflows.`);

  return (
    <div className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)' }}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
          Cashflow Analysis · Last 30 days
        </p>
        <button onClick={onFullAnalysis} className="text-xs font-semibold flex items-center gap-1"
          style={{ color: '#F7931A', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          Full analysis <ChevronRight size={11} />
        </button>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Monthly Burn', value: burnLabel, sub: 'avg outflow' },
          { label: 'Runway', value: summary.runway, sub: 'at current rate' },
          { label: 'Top Recipient', value: topLabel, sub: top ? `${top.count} txs · ${fmtUSD(top.totalUSD)}` : 'no outflows' },
        ].map(s => (
          <div key={s.label} className="rounded-xl px-4 py-3"
            style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-lo)' }}>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
            <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{s.value}</p>
            <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {insights.slice(0, 3).map((ins, i) => (
            <div key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span className="mt-1 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: '#F7931A' }} />
              {ins}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dashboard View ──────────────────────────────────────────
function DashboardView({ payments, log, setTab, isLoading, musdBalance, walletAddress }: {
  payments: any[]; log: ExecutionLogEntry[]; setTab: (t: Tab) => void; isLoading: boolean; musdBalance: number; walletAddress?: string;
}) {
  return (
    <div className="space-y-7">
      {/* Header + live price ticker */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.04em', fontSize: '1.75rem' }}>
            Treasury Overview
          </h2>
          <p className="mt-1" style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            Bitcoin-backed cashflow · Mezo Network
          </p>
        </div>
        <PriceTicker />
      </div>

      {/* Stats from real Mezo wallet data */}
      <VaultStats />

      {/* Live cashflow summary (burn rate, runway, top recipient) */}
      {walletAddress && <WalletSummaryBar address={walletAddress} onFullAnalysis={() => setTab('analyze')} />}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <CashflowTimeline payments={payments} />
        <CashflowForecast payments={payments} musdBalance={musdBalance} />
      </div>

      {/* Monthly Consolidation — roll tokens into MUSD (Feature 1) */}
      {walletAddress && <ConsolidationCard walletAddress={walletAddress} />}

      {/* My Transactions — owner-gated tagging / overrides / notes (Bug 2) */}
      {walletAddress && <MyTransactions walletAddress={walletAddress} />}

      <InsightsFeed />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card-base p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold" style={{ color: 'var(--text-primary)', fontSize: '1rem' }}>Upcoming Payments</h3>
            <button onClick={() => setTab('create')} className="btn-ghost" style={{ padding: '5px 12px', fontSize: 13, color: 'var(--accent)' }}>
              <Plus size={12} /> New
            </button>
          </div>
          <PaymentList payments={payments.filter(p => p.isActive).slice(0, 4)} showCancelButton={false} />
          {payments.length > 4 && (
            <button onClick={() => setTab('payments')}
              className="w-full text-center text-xs mt-4 flex items-center justify-center gap-1 py-2.5 rounded-lg transition-colors"
              style={{ color: 'var(--text-muted)', background: 'var(--bg-raised)' }}>
              View all {payments.length} payments <ChevronRight size={11} />
            </button>
          )}
        </div>
        <div className="card-base p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold" style={{ color: 'var(--text-primary)', fontSize: '1rem' }}>Agent Activity</h3>
            <button onClick={() => setTab('agent')} className="btn-ghost" style={{ padding: '5px 12px', fontSize: 13, color: 'var(--accent)' }}>
              View all →
            </button>
          </div>
          <ExecutionLog log={log.slice(0, 5)} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LANDING PAGE
// Dark, cinematic — Impeccable / Taste-skill / UI-UX Pro Max
// ─────────────────────────────────────────────────────────────
function LandingPage() {
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 60]);
  const heroO = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  const pain = [
    { icon: Clock3,        title: 'No recurring payment layer',  body: 'Bitcoin holders have no native way to schedule repeating MUSD payments. Every recurring obligation requires manual intervention.', accent: '#F7931A' },
    { icon: ShieldOff,     title: 'Unsafe autonomous execution', body: 'Autonomous treasury tools either require full custody or have no policy enforcement — leaving your BTC-backed capital exposed.',    accent: '#F7931A' },
    { icon: Eye,           title: 'Zero treasury visibility',    body: 'Protocols and teams have no unified view of upcoming obligations, MUSD reserve health, or cashflow timing on Mezo.',               accent: '#8b5cf6' },
    { icon: AlertTriangle, title: 'Fragmented operations',       body: 'Payroll, subscriptions, API bills, and infrastructure costs live across wallets with no structured MUSD execution layer.',          accent: '#3b82f6' },
    { icon: GitBranch,     title: 'Manual approval burden',      body: "Every payment requires a human to sign. There's no way to pre-approve policy-bound recurring Bitcoin-backed transactions.",          accent: '#22c55e' },
  ];

  const steps = [
    { n: '01', title: 'Deposit BTC Collateral',  body: 'Lock BTC into the MUSDVault contract on Mezo. Your Bitcoin never leaves the vault — MUSD is minted against it, not sold.', accent: 'var(--btc)' },
    { n: '02', title: 'Access MUSD Liquidity',   body: 'Mint MUSD against your BTC collateral. Access stablecoin liquidity for payments without selling your Bitcoin position.',      accent: '#F7931A' },
    { n: '03', title: 'Schedule Payments',        body: "Set up recurring MUSD payments to wallets or x402 API endpoints. Define recipient, amount, and cadence — Bitstream's agent handles execution.", accent: '#8b5cf6' },
    { n: '04', title: 'Agent Executes + Yields',  body: 'The autonomous agent executes payments on schedule. Idle MUSD reserves are routed into Mezo yield strategies with automatic unwinding before payouts.', accent: '#00d4aa' },
  ];

  const integrations = [
    { name: 'Mezo',       tag: 'L2',         color: '#F7931A',   desc: 'Bitcoin-native L2. BTC collateral, MUSD minting, and settlement infrastructure.' },
    { name: 'MUSD',       tag: 'Stablecoin', color: '#00d4aa',   desc: 'Mezo-native USD stablecoin. Minted against BTC collateral for programmable payments.' },
    { name: 'x402',       tag: 'HTTP Pay',   color: '#8b5cf6',   desc: 'Pay-per-request HTTP monetization. Autonomous MUSD payments to API endpoints.' },
    { name: 'MUSDVault',  tag: 'Contract',   color: '#F7931A',   desc: 'On-chain vault contract. Non-custodial BTC collateral management and payment scheduling.' },
    { name: 'BullMQ',     tag: 'Agent',      color: '#22c55e',   desc: 'Redis-backed job queue powering the autonomous payment execution agent.' },
    { name: 'wagmi',      tag: 'EVM',        color: '#3b82f6',   desc: 'EVM-compatible wallet connection. MetaMask, WalletConnect, and Mezo Passport support.' },
    { name: 'viem',       tag: 'Web3',       color: '#06b6d4',   desc: 'Type-safe EVM interactions for vault reads, payment scheduling, and state sync.' },
    { name: 'Mezo Yield', tag: 'Yield',      color: '#f59e0b',   desc: 'Route idle MUSD reserves into Mezo-native yield strategies. Auto-unwind before payouts.' },
  ];

  return (
    <div style={{ background: 'var(--bg-void)', fontFamily: 'var(--font-body)', color: 'var(--text-secondary)', overflowX: 'hidden', minHeight: '100vh' }}>

      {/* ── Background canvas ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 0 }}>
        {/* Large atmospheric orbs */}
        <div className="absolute" style={{
          top: '-12%', left: '-8%', width: '60vw', height: '60vw', maxWidth: 900,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,0,64,0.10) 0%, transparent 65%)',
          filter: 'blur(80px)',
        }} />
        <div className="absolute" style={{
          top: '5%', right: '-8%', width: '45vw', height: '45vw', maxWidth: 700,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(247,147,26,0.08) 0%, transparent 65%)',
          filter: 'blur(70px)',
        }} />
        <div className="absolute" style={{
          bottom: '15%', left: '45%', transform: 'translateX(-50%)',
          width: '80vw', height: '55vw', maxWidth: 1200,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,0,64,0.04) 0%, transparent 60%)',
          filter: 'blur(100px)',
        }} />
        {/* Grid overlay */}
        <div className="absolute inset-0" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '80px 80px',
          maskImage: 'radial-gradient(ellipse 85% 75% at 50% 35%, black 20%, transparent 75%)',
        }} />
      </div>

      {/* ── NAV ── */}
      <nav className="sticky top-0 z-50 backdrop-blur-2xl" style={{
        background: 'var(--nav-bg)',
        borderBottom: '1px solid var(--nav-border)',
      }}>
        <div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-6 sm:px-10 lg:px-14">
          <LogoWordmark size="md" />

          <div className="hidden md:flex items-center gap-8">
            {[
              { href: '#problem', label: 'Problem' },
              { href: '#how',     label: 'How it works' },
              { href: '#modes',   label: 'Modes' },
            ].map(({ href, label }) => (
              <a key={href} href={href}
                className="text-[14px] font-medium transition-colors duration-200"
                style={{ color: 'var(--text-tertiary)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}>
                {label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <WalletConnect />
          </div>
        </div>
      </nav>

      <main style={{ position: 'relative', zIndex: 1 }}>

        {/* ── HERO ── */}
        <section ref={heroRef}
          className="mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-14"
          style={{ paddingTop: 'clamp(80px, 11vw, 140px)', paddingBottom: 0 }}>
          <div className="grid lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-20">

            {/* Left */}
            <motion.div style={{ y: heroY, opacity: heroO }} className="relative z-10 pb-16 lg:pb-40">
              <motion.div {...upMount(0)}>
                <span className="inline-flex items-center gap-2.5 rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.22em]"
                  style={{ background: 'rgba(247,147,26,0.10)', border: '1px solid rgba(247,147,26,0.26)', color: '#F7931A' }}>
                  <span className="relative flex h-2 w-2">
                    <span className="absolute h-full w-full rounded-full animate-ping opacity-60" style={{ background: '#F7931A' }} />
                    <span className="relative h-2 w-2 rounded-full" style={{ background: '#F7931A' }} />
                  </span>
                  Built on Mezo · Bitcoin Cashflow
                </span>
              </motion.div>

              <motion.h1 {...upMount(0.06)} style={{
                marginTop: '2.2rem',
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(3.6rem, 7vw, 7.5rem)',
                fontWeight: 800,
                letterSpacing: '-0.05em',
                lineHeight: 0.92,
                color: 'var(--text-primary)',
              }}>
                Your Bitcoin,<br />
                <span style={{ color: '#F7931A' }}>Working.</span>
              </motion.h1>

              <motion.p {...upMount(0.14)}
                className="mt-9 leading-[1.9]"
                style={{ color: 'var(--text-secondary)', maxWidth: 500, fontSize: '1.1rem' }}>
                Lock BTC as collateral, access MUSD liquidity, and automate recurring payments — to wallets or x402 API endpoints. Set once, runs forever. Self-custodial.
              </motion.p>

              <motion.div {...upMount(0.20)} className="mt-8 flex flex-wrap gap-2.5">
                {[
                  { icon: ShieldCheck,  text: 'Non-custodial' },
                  { icon: Zap,          text: 'Automated cashflow' },
                  { icon: BrainCircuit, text: 'AI treasury agent' },
                  { icon: LockKeyhole,  text: 'Policy enforced' },
                ].map(({ icon: Icon, text }) => (
                  <div key={text}
                    className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'var(--text-secondary)' }}>
                    <Icon className="h-3.5 w-3.5 opacity-60" />
                    {text}
                  </div>
                ))}
              </motion.div>

              <motion.div {...upMount(0.27)} className="mt-11 flex flex-wrap items-center gap-4">
                <WalletConnect />
                <a href="#how"
                  className="inline-flex items-center gap-2 font-medium transition-all"
                  style={{ color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', padding: '13px 24px', borderRadius: 'var(--r-md)', fontSize: '14px' }}>
                  How it works
                  <ArrowRight className="h-4 w-4" />
                </a>
              </motion.div>

              <motion.div {...upMount(0.34)}
                className="mt-16 flex items-center gap-12 flex-wrap"
                style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '2.2rem' }}>
                <HeroStat n="100%" label="Non-custodial" />
                <HeroStat n="∞"    label="Auditable logs" />
                <HeroStat n="BTC"  label="Backed by Bitcoin" />
              </motion.div>
            </motion.div>

            {/* Right: Bitstream Flow Animation (pure Framer Motion) */}
            <motion.div initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: E, delay: 0.15 }}
              className="relative hidden lg:block">
              <BitstreamFlowAnimation />
            </motion.div>
          </div>
        </section>

        {/* Scroll cue */}
        <div className="flex justify-center py-12">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6, duration: 0.8 }}
            className="flex flex-col items-center gap-2.5 text-[10px] uppercase tracking-[0.32em]"
            style={{ color: 'var(--text-muted)' }}>
            Scroll
            <motion.div animate={{ y: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}>
              <ChevronRight className="h-3.5 w-3.5 rotate-90" />
            </motion.div>
          </motion.div>
        </div>

        {/* ── INTEGRATIONS ── */}
        <section className="mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-14 pb-28">
          <Reveal>
            <div className="text-center mb-14">
              <SectionLabel>Ecosystem</SectionLabel>
              <h2 className="font-bold text-[var(--text-primary)] leading-[1.0] tracking-[-0.05em]"
                style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.2rem,3.8vw,3.6rem)' }}>
                Built on the most powerful<br />
                <span className="gradient-btc">Bitcoin infrastructure.</span>
              </h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {integrations.map(i => <IntCard key={i.name} {...i} />)}
            </div>
          </Reveal>
        </section>

        {/* ── PROBLEM ── */}
        <section id="problem"
          className="mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-14"
          style={{ paddingTop: 'clamp(72px,9vw,120px)', paddingBottom: 'clamp(80px,10vw,140px)' }}>
          <Reveal>
            <SectionLabel accent>The Problem</SectionLabel>
            <div className="grid lg:grid-cols-[1fr_auto] lg:items-end gap-12 mb-16">
              <h2 className="font-bold leading-[1.0] tracking-[-0.055em]"
                style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.8rem,5.5vw,5.2rem)', color: 'var(--text-primary)' }}>
                Bitcoin cashflow<br />is still manual.<br />
                <span className="gradient-accent">On every chain.</span>
              </h2>
              <p className="max-w-sm text-[1.05rem] leading-[1.9]" style={{ color: 'var(--text-secondary)' }}>
                Teams manage BTC-backed treasuries across spreadsheets and Discord threads. Payroll windows get missed. AI agents can&apos;t pay their own API bills. There&apos;s no execution layer.
              </p>
            </div>
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {pain.map(({ icon, title, body, accent }, i) => (
              <Reveal key={title} delay={i * 0.06}>
                <PainCard icon={icon} title={title} body={body} accent={accent} />
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section id="how"
          className="mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-14"
          style={{ paddingTop: 'clamp(72px,9vw,120px)', paddingBottom: 'clamp(80px,10vw,140px)' }}>
          <div className="grid gap-16 lg:grid-cols-[1fr_1.1fr] lg:items-start">
            <Reveal>
              <div className="lg:sticky lg:top-28">
                <SectionLabel>Product Flow</SectionLabel>
                <h2 className="font-bold leading-[1.0] tracking-[-0.05em]"
                  style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.4rem,4.2vw,4.0rem)', color: 'var(--text-primary)' }}>
                  Four steps.<br />
                  <span className="gradient-accent">Full automation.</span>
                </h2>
                <p className="mt-7 text-[1.05rem] leading-[1.9]" style={{ color: 'var(--text-secondary)', maxWidth: 400 }}>
                  Bitstream sits between your BTC collateral and your obligations — minting MUSD, scheduling payments, executing automatically, and routing idle reserves into yield.
                </p>
                {/* AI insight preview card */}
                <div className="mt-11 rounded-[22px] p-6 card-base">
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] mb-5" style={{ color: 'var(--text-muted)' }}>
                    Live agent insight stream
                  </p>
                  <div className="space-y-4">
                    {[
                      { text: '"Payroll batch due in 3 days. Reserve buffer healthy."',    color: '#F7931A' },
                      { text: '"Idle MUSD detected. Routing to Mezo yield strategy."',     color: '#00d4aa' },
                      { text: '"x402 API endpoint payment executed successfully."',         color: '#8b5cf6' },
                      { text: '"Collateral ratio at 187%. No action required."',            color: '#22c55e' },
                    ].map(({ text, color }) => (
                      <div key={text} className="flex items-start gap-3.5">
                        <BrainCircuit className="h-4 w-4 shrink-0 mt-0.5" style={{ color }} />
                        <p className="text-[0.875rem] leading-[1.75]" style={{ color: 'var(--text-secondary)' }}>{text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Reveal>
            <div className="pt-1">
              {steps.map(({ n, title, body, accent }, i) => (
                <Reveal key={n} delay={i * 0.08}>
                  <FlowStep n={n} title={title} body={body} accent={accent} last={i === steps.length - 1} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── MODES ── */}
        <section id="modes"
          className="mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-14"
          style={{ paddingTop: 'clamp(72px,9vw,120px)', paddingBottom: 'clamp(80px,10vw,140px)' }}>
          <Reveal>
            <div className="text-center mb-16">
              <SectionLabel>Operating Modes</SectionLabel>
              <h2 className="font-bold leading-[1.0] tracking-[-0.055em]"
                style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.6rem,4.8vw,4.6rem)', color: 'var(--text-primary)' }}>
                You set the rules.<br />
                <span className="gradient-accent">Bitstream follows them.</span>
              </h2>
            </div>
          </Reveal>
          <div className="grid gap-5 lg:grid-cols-2">
            <Reveal delay={0.05}>
              <ModeCard mode="safe" label="Safe Mode · Default"
                headline={<>Agent suggests.<br /><span style={{ color: '#00d4aa' }}>You approve.</span></>}
                accent1="#00d4aa" sub="Full visibility, zero surprises. The agent queues payments and shows reserve impact — you sign each one."
                features={[
                  { text: 'Agent analyzes and queues payments', yes: true },
                  { text: 'You approve every execution', yes: true },
                  { text: 'Reserve impact shown before signing', yes: true },
                  { text: 'Full execution audit log', yes: true },
                  { text: 'Autonomous execution', yes: false },
                ]}
                featured />
            </Reveal>
            <Reveal delay={0.10}>
              <ModeCard mode="auto" label="Autopilot Mode"
                headline={<>Agent executes.<br /><span style={{ color: '#F7931A' }}>Within limits.</span></>}
                accent1="#F7931A" sub="Define spending caps, whitelists, and time windows. Bitstream handles approved recurring payments automatically."
                features={[
                  { text: 'Agent executes approved recurring payments', yes: true },
                  { text: 'Hard spending caps enforced per period', yes: true },
                  { text: 'Destination whitelist required', yes: true },
                  { text: 'Admin override always available', yes: true },
                  { text: 'Unrestricted agent fund access', yes: false },
                ]} />
            </Reveal>
          </div>
          <Reveal delay={0.15}>
            <div className="mt-5 flex items-start gap-5 rounded-[20px] px-7 py-6 card-base">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'var(--green-dim)', border: '1px solid var(--green-border)' }}>
                <ShieldCheck className="h-5 w-5" style={{ color: 'var(--green)' }} />
              </div>
              <div>
                <p className="font-bold mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.02em', fontSize: '1rem' }}>
                  Security guarantee
                </p>
                <p className="text-[0.93rem] leading-[1.85]" style={{ color: 'var(--text-secondary)' }}>
                  In both modes, Bitstream never has unrestricted fund access. Autopilot only handles payments within your pre-approved execution paths. Spending caps are hard-enforced on-chain. No agent can override a policy you set.
                </p>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── ARCHITECTURE ── */}
        <section id="architecture"
          className="mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-14"
          style={{ paddingTop: 'clamp(72px,9vw,120px)', paddingBottom: 'clamp(56px,7vw,96px)' }}>
          <Reveal>
            <div className="text-center mb-14">
              <SectionLabel>Architecture</SectionLabel>
              <h2 className="font-bold leading-[1.0] tracking-[-0.05em]"
                style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.2rem,3.8vw,3.6rem)', color: 'var(--text-primary)' }}>
                Three layers.<br />
                <span className="gradient-btc">One bitcoin pipeline.</span>
              </h2>
            </div>
          </Reveal>
          <Reveal delay={0.05}>
            <ArchitectureDiagram />
          </Reveal>
        </section>

        {/* ── STATS ── */}
        <section className="mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-14"
          style={{ paddingTop: 'clamp(40px,5vw,80px)', paddingBottom: 'clamp(56px,7vw,96px)' }}>
          <Reveal>
            <StatsRow />
          </Reveal>
        </section>

        {/* ── BOT CTA ── */}
        <section id="bot"
          className="mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-14"
          style={{ paddingTop: 'clamp(40px,5vw,80px)', paddingBottom: 'clamp(72px,9vw,120px)' }}>
          <Reveal>
            <BotCta />
          </Reveal>
        </section>

        {/* ── CTA ── */}
        <section className="mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-14"
          style={{ paddingBottom: 'clamp(72px,9vw,120px)' }}>
          <Reveal>
            <div className="relative overflow-hidden rounded-[44px] px-10 py-24 sm:px-16 sm:py-28 lg:px-24 lg:py-32 text-center card-hero">
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-x-0 bottom-0 h-96"
                  style={{ background: 'radial-gradient(ellipse at 50% 130%, rgba(255,0,64,0.14), transparent 55%)' }} />
                <div className="absolute inset-x-0 top-0 h-48"
                  style={{ background: 'radial-gradient(ellipse at 50% -20%, rgba(247,147,26,0.09), transparent 55%)' }} />
                <div className="absolute inset-0" style={{
                  backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
                  backgroundSize: '64px 64px',
                  maskImage: 'radial-gradient(ellipse 75% 75% at 50% 50%, black, transparent)',
                }} />
                <div className="absolute inset-x-0 top-0 h-px"
                  style={{ background: 'linear-gradient(90deg, transparent 5%, rgba(255,0,64,0.5) 50%, transparent 95%)' }} />
              </div>
              <div className="relative">
                {/* Large logo mark */}
                <motion.div className="mx-auto mb-10 flex items-center justify-center"
                  animate={{ y: [0, -8, 0] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}>
                  <LogoMark size={72} bg="#0a0a0a" />
                </motion.div>
                <p className="text-[11px] font-bold uppercase tracking-[0.34em]" style={{ color: 'var(--text-muted)' }}>
                  Connect your wallet to begin
                </p>
                <h2 className="mt-6 font-bold leading-[1.06] tracking-[-0.055em]"
                  style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.2rem,5vw,4.2rem)', color: 'var(--text-primary)' }}>
                  Your Bitcoin. Working.
                </h2>
                <p className="mx-auto mt-6 text-[1.05rem] leading-[1.9]"
                  style={{ color: 'var(--text-secondary)', maxWidth: 500 }}>
                  Connect your wallet to access the Bitstream dashboard. Lock BTC, mint MUSD, and automate your cashflow obligations in minutes.
                </p>
                <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                  <WalletConnect />
                  <a href="https://github.com/enkethomassen/bitstream" target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-2 font-medium"
                    style={{ color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', padding: '13px 24px', borderRadius: 'var(--r-md)', fontSize: '14px' }}>
                    View on GitHub
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </div>
                <div className="mt-16 flex flex-wrap items-center justify-center gap-6 text-[11px] font-semibold tracking-[0.06em]"
                  style={{ color: 'var(--text-muted)' }}>
                  {['Mezo', '·', 'MUSD', '·', 'x402', '·', 'MUSDVault', '·', 'BullMQ', '·', 'wagmi'].map((n, i) => (
                    <span key={i}>{n}</span>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ── FOOTER ── */}
      <footer style={{ position: 'relative', zIndex: 1, borderTop: '1px solid rgba(255,255,255,0.07)', background: 'var(--bg-surface)' }}>
        <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-6 py-11 sm:px-10 lg:flex-row lg:items-center lg:justify-between lg:px-14">
          <LogoWordmark size="sm" />
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            © {new Date().getFullYear()} Bitstream. Mezo Hackathon 2026.
          </p>
          <div className="flex items-center gap-6 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            {[
              { label: 'GitHub', href: 'https://github.com/enkethomassen/bitstream' },
              { label: 'Docs',   href: '#' },
            ].map(({ label, href }) => (
              <a key={label} href={href} target={href.startsWith('http') ? '_blank' : undefined}
                rel="noreferrer"
                className="transition-colors"
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}>
                {label}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── Count-up ────────────────────────────────────────────────
function CountUp({ to, decimals = 0, prefix = '', suffix = '', durationMs = 1400 }: {
  to: number; decimals?: number; prefix?: string; suffix?: string; durationMs?: number;
}) {
  const [value, setValue] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (started || !ref.current) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started) {
        setStarted(true);
        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min((now - start) / durationMs, 1);
          const eased = 1 - Math.pow(1 - t, 3);
          setValue(eased * to);
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
    }, { threshold: 0.25 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [started, to, durationMs]);

  const formatted = decimals === 0
    ? Math.round(value).toLocaleString()
    : value.toFixed(decimals);
  return <span ref={ref}>{prefix}{formatted}{suffix}</span>;
}

// ── Architecture Diagram ────────────────────────────────────
function ArchitectureDiagram() {
  const layers = [
    { tag: '01', name: 'Capital Layer',     subtitle: 'Mezo',                 desc: 'BTC collateral. MUSD minting via MUSDVault.sol. Non-custodial.', color: '#F7931A' },
    { tag: '02', name: 'Automation Layer',  subtitle: 'Bitstream Agent',      desc: 'Scheduler, payment executor, vault monitor, AI forecast agent.', color: '#00C9A7' },
    { tag: '03', name: 'Payment Layer',     subtitle: 'x402 + on-chain',      desc: 'HTTP 402 pay-per-request and direct MUSD wallet transfers.',     color: '#8B5CF6' },
  ];

  return (
    <div className="relative">
      {/* Connector lines (desktop only) */}
      <div className="pointer-events-none absolute inset-x-0 top-[50%] hidden lg:block -translate-y-1/2 z-0">
        <svg className="w-full" height="2" viewBox="0 0 100 2" preserveAspectRatio="none">
          <line x1="0" y1="1" x2="100" y2="1" stroke="rgba(247,147,26,0.25)" strokeDasharray="0.6 0.6" strokeWidth="0.2" />
        </svg>
      </div>

      <div className="relative grid gap-5 lg:grid-cols-3 z-10">
        {layers.map((l, i) => (
          <motion.div key={l.tag}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-8%' }}
            transition={{ duration: 0.6, ease: E, delay: i * 0.08 }}
            className="relative rounded-[22px] p-8 card-base"
            style={{ border: `1px solid ${l.color}30` }}
          >
            <div className="absolute inset-x-0 top-0 h-px rounded-t-[22px]"
              style={{ background: `linear-gradient(90deg, transparent 8%, ${l.color}55 50%, transparent 92%)` }} />

            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl"
                style={{ background: `${l.color}14`, border: `1px solid ${l.color}28` }}>
                <span className="font-mono text-[11px] font-bold" style={{ color: l.color }}>{l.tag}</span>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: l.color }}>
                {l.subtitle}
              </span>
            </div>

            <h3 className="font-bold mb-3"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.025em', fontSize: '1.25rem' }}>
              {l.name}
            </h3>
            <p className="text-[0.95rem] leading-[1.9]" style={{ color: 'var(--text-secondary)' }}>
              {l.desc}
            </p>

            {/* arrow → between cards on mobile */}
            {i < layers.length - 1 && (
              <div className="mt-6 lg:hidden flex items-center justify-center">
                <ArrowRight className="h-4 w-4" style={{ color: l.color, opacity: 0.6 }} />
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Stats Row ──────────────────────────────────────────────
function StatsRow() {
  const stats = [
    { label: 'Total BTC Secured',    value: 142.7,    decimals: 1, suffix: ' BTC', color: '#F7931A' },
    { label: 'Payments Automated',   value: 2847,     decimals: 0, suffix: '',     color: '#00C9A7' },
    { label: 'MUSD in Circulation',  value: 8.4,      decimals: 1, prefix: '$',    suffix: 'M', color: '#8B5CF6' },
    { label: 'Active Vaults',        value: 341,      decimals: 0, suffix: '',     color: '#FF0040' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((s, i) => (
        <motion.div key={s.label}
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10%' }}
          transition={{ duration: 0.55, ease: E, delay: i * 0.06 }}
          className="rounded-[22px] p-7 card-base"
          style={{ border: `1px solid ${s.color}24` }}
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-4" style={{ color: s.color }}>
            {s.label}
          </p>
          <p className="font-bold leading-none tabular-nums"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(1.8rem,3.2vw,2.8rem)',
              letterSpacing: '-0.045em',
              color: 'var(--text-primary)',
            }}>
            <CountUp to={s.value} decimals={s.decimals} prefix={s.prefix} suffix={s.suffix} />
          </p>
        </motion.div>
      ))}
    </div>
  );
}

// ── Bot CTA ─────────────────────────────────────────────────
function BotCta() {
  const [addr, setAddr] = useState('');

  const goAnalyze = () => {
    if (!addr.trim()) return;
    window.location.href = `/analyze?address=${encodeURIComponent(addr.trim())}`;
  };

  return (
    <div className="relative overflow-hidden rounded-[36px] p-10 sm:p-14 card-base"
      style={{ border: '1px solid rgba(247,147,26,0.18)' }}>
      <div className="absolute inset-x-0 top-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent 5%, rgba(247,147,26,0.55) 50%, transparent 95%)' }} />
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 bottom-0 h-72"
          style={{ background: 'radial-gradient(ellipse at 50% 130%, rgba(247,147,26,0.10), transparent 55%)' }} />
      </div>

      <div className="relative grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:items-center">
        <div>
          <SectionLabel>Wallet Analyzer · Free</SectionLabel>
          <h2 className="font-bold leading-[1.0] tracking-[-0.05em]"
            style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem,3.4vw,3.2rem)', color: 'var(--text-primary)' }}>
            Check your wallet<br />
            <span className="gradient-btc">in 30 seconds.</span>
          </h2>
          <p className="mt-6 text-[1.05rem] leading-[1.9]" style={{ color: 'var(--text-secondary)', maxWidth: 460 }}>
            Paste any EVM or Bitcoin address. Get monthly burn, runway, recurring patterns, and reserve score — backed by GPT-4o. No wallet connection needed.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3 max-w-xl">
            <input
              type="text"
              value={addr}
              onChange={e => setAddr(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') goAnalyze(); }}
              placeholder="0x… or bc1q…"
              className="flex-1 rounded-[var(--r-md)] px-5 py-3.5 text-[14px] font-mono outline-none"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: 'var(--text-primary)',
              }}
            />
            <button
              onClick={goAnalyze}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--r-md)] px-6 py-3.5 text-[14px] font-bold transition-all"
              style={{
                background: '#F7931A',
                color: '#0a0a0a',
                boxShadow: '0 4px 24px rgba(247,147,26,0.35)',
              }}
            >
              Analyze Free
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: 'var(--text-muted)' }}>
            Or message us on
          </p>
          <a href="https://t.me/MezoStatsbot" target="_blank" rel="noreferrer"
            className="flex items-center gap-4 rounded-[20px] p-5 transition-all card-base"
            style={{ border: '1px solid rgba(34,158,255,0.22)' }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl flex-shrink-0"
              style={{ background: 'rgba(34,158,255,0.12)', border: '1px solid rgba(34,158,255,0.28)' }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="#229ed9">
                <path d="M22 3L2 11l6 2 2 7 4-4 6 5 2-18z"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold leading-tight" style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>@MezoStatsbot</p>
              <p className="text-[0.85rem] mt-1 truncate" style={{ color: 'var(--text-secondary)' }}>
                /vault · /analyze — live stats in Telegram
              </p>
            </div>
            <ArrowRight className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
          </a>

          <a href="https://wa.me/" target="_blank" rel="noreferrer"
            className="flex items-center gap-4 rounded-[20px] p-5 transition-all card-base"
            style={{ border: '1px solid rgba(37,211,102,0.22)' }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl flex-shrink-0"
              style={{ background: 'rgba(37,211,102,0.12)', border: '1px solid rgba(37,211,102,0.28)' }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="#25D366">
                <path d="M12 2a10 10 0 0 0-8.7 14.9L2 22l5.2-1.3A10 10 0 1 0 12 2zm5.6 14.2c-.2.6-1.2 1.2-1.7 1.2-.4 0-1 0-3.3-.9-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.5c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.1 1 2 1.3 2.3 1.4.3.1.4.1.6-.1l.6-.7c.2-.2.4-.2.6-.1l1.7.8c.2.1.4.2.4.3 0 .2 0 .8-.3 1.4z"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold leading-tight" style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>WhatsApp bot</p>
              <p className="text-[0.85rem] mt-1 truncate" style={{ color: 'var(--text-secondary)' }}>
                analyse · balance — same insights, native to WA
              </p>
            </div>
            <ArrowRight className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Integration Card ────────────────────────────────────────
function IntCard({ name, tag, color, desc }: { name: string; tag: string; color: string; desc: string }) {
  return (
    <motion.div
      whileHover={{ y: -4, transition: { duration: 0.22, ease: E } }}
      className="group relative flex flex-col gap-5 rounded-[22px] p-7"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}
    >
      <div className="pointer-events-none absolute inset-0 rounded-[22px] opacity-0 group-hover:opacity-100 transition-opacity duration-400"
        style={{ background: `radial-gradient(ellipse at 30% 0%, ${color}14 0%, transparent 60%)` }} />
      <div className="absolute inset-x-0 top-0 h-px rounded-t-[22px] opacity-0 group-hover:opacity-100 transition-opacity duration-400"
        style={{ background: `linear-gradient(90deg, transparent, ${color}50, transparent)` }} />
      <div className="flex items-center justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl"
          style={{ background: `${color}14`, border: `1px solid ${color}24` }}>
          <span className="h-3 w-3 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}99` }} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] px-3 py-1.5 rounded-full"
          style={{ background: `${color}12`, color, border: `1px solid ${color}22` }}>
          {tag}
        </span>
      </div>
      <div>
        <p className="font-bold tracking-[-0.02em] mb-2"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', fontSize: '1rem' }}>
          {name}
        </p>
        <p className="leading-[1.8]" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{desc}</p>
      </div>
    </motion.div>
  );
}

// ── Hero Dashboard Preview (3D floating) ───────────────────
function HeroDashboardPreview() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const stats = [
    { label: 'BTC Collateral',   value: '2.4500',   unit: 'BTC',  color: '#F7931A', glow: 'rgba(247,147,26,0.35)' },
    { label: 'MUSD Available',   value: '142,500',  unit: 'MUSD', color: '#F7931A', glow: 'rgba(247,147,26,0.35)' },
    { label: 'Collateral Health',value: '187%',     unit: '',     color: '#22c55e', glow: 'rgba(34,197,94,0.35)' },
    { label: 'Active Schedules', value: '7',        unit: '',     color: '#a8a8a8', glow: 'rgba(168,168,168,0.2)' },
  ];

  const activity = [
    { text: 'Payroll batch executed', amount: '12,000 MUSD', ok: true },
    { text: 'x402 API payment',       amount: '50 MUSD',     ok: true },
    { text: 'Idle yield allocated',   amount: '30,000 MUSD', ok: true },
  ];

  return (
    <div className="relative" style={{ perspective: 1200 }}>
      {/* Main card — subtle 3D tilt */}
      <motion.div
        animate={{
          rotateY: [0, -2.5, 0, 2.5, 0],
          rotateX: [0, 1.2, 0, -1.2, 0],
        }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        className="rounded-[28px] overflow-hidden"
        style={{
          background: '#111111',
          border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.8), 0 0 120px rgba(255,0,64,0.08)',
          transformStyle: 'preserve-3d',
        }}
      >
        {/* Window chrome */}
        <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#161616' }}>
          <span className="w-3 h-3 rounded-full" style={{ background: '#FF5F57' }} />
          <span className="w-3 h-3 rounded-full" style={{ background: '#FFBD2E' }} />
          <span className="w-3 h-3 rounded-full" style={{ background: '#28C840' }} />
          <span className="ml-5 text-[10px] font-mono" style={{ color: '#484848' }}>bitstream.app/dashboard</span>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.8)' }} />
            <span className="text-[9px] font-mono" style={{ color: '#22c55e' }}>live</span>
          </div>
        </div>

        {/* Dashboard body */}
        <div className="p-5 space-y-4">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <LogoWordmark size="sm" />
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(247,147,26,0.10)', border: '1px solid rgba(247,147,26,0.22)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#F7931A' }} />
              <span className="text-[10px] font-bold" style={{ color: '#F7931A' }}>Mezo Mainnet</span>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            {stats.map(s => (
              <motion.div key={s.label}
                whileHover={{ scale: 1.02 }}
                className="rounded-xl p-4"
                style={{ background: '#181818', border: '1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-[9px] font-bold uppercase tracking-[0.16em] mb-2.5" style={{ color: '#484848' }}>{s.label}</p>
                <p className="font-bold tabular-nums leading-none" style={{ fontFamily: 'var(--font-mono)', color: s.color, fontSize: '1.25rem', textShadow: `0 0 20px ${s.glow}` }}>
                  {s.value}<span className="text-[10px] ml-1 opacity-60">{s.unit}</span>
                </p>
              </motion.div>
            ))}
          </div>

          {/* Activity feed */}
          <div className="rounded-xl p-4" style={{ background: '#181818', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: '#484848' }}>Agent Activity</p>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e', boxShadow: '0 0 8px rgba(34,197,94,0.8)', animation: 'pulse-green 2.8s ease-in-out infinite' }} />
            </div>
            <div className="space-y-2.5">
              {activity.map((row, i) => (
                <motion.div key={row.text}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#22c55e' }} />
                    <span className="text-[11px]" style={{ color: '#6e6e6e' }}>{row.text}</span>
                  </div>
                  <span className="font-mono text-[11px] font-semibold" style={{ color: '#a8a8a8' }}>{row.amount}</span>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Progress bar — collateral ratio */}
          <div className="rounded-xl p-4" style={{ background: '#181818', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: '#484848' }}>Collateral Ratio</p>
              <span className="text-[10px] font-mono font-bold" style={{ color: '#22c55e' }}>187% · Healthy</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: '74%' }}
                transition={{ duration: 1.2, ease: E, delay: 0.8 }}
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #22c55e, #16a34a)', boxShadow: '0 0 12px rgba(34,197,94,0.5)' }}
              />
            </div>
          </div>
        </div>
      </motion.div>

      {/* Floating status pills */}
      {[
        { pos: 'top-[6%] -left-[12%]',    color: '#F7931A', border: 'rgba(247,147,26,0.3)', label: 'BTC Secured',  sub: 'non-custodial', delay: 0.6 },
        { pos: 'bottom-[22%] -right-[9%]', color: '#F7931A', border: 'rgba(247,147,26,0.3)',   label: 'Agent Active', sub: 'next_run: 58s', delay: 0.75 },
        { pos: 'bottom-[48%] -left-[12%]', color: '#8b5cf6', border: 'rgba(139,92,246,0.3)', label: 'x402 Ready',  sub: 'http_pay: live', delay: 0.9 },
      ].map(({ pos, color, border, label, sub, delay }) => (
        <motion.div key={label}
          initial={{ opacity: 0, scale: 0.85, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.55, ease: E, delay }}
          className={`pointer-events-none absolute ${pos} hidden xl:block`}
        >
          <motion.div
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 3.5 + Math.random(), repeat: Infinity, ease: 'easeInOut' }}
          >
            <div className="rounded-2xl px-4 py-3"
              style={{ background: '#111111', border: `1px solid ${border}`, boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 24px ${color}18`, minWidth: 130 }}>
              <div className="flex items-center gap-2" style={{ color }}>
                <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                <span className="text-[12px] font-bold">{label}</span>
              </div>
              <div className="mt-1 font-mono text-[10px]" style={{ color: '#484848' }}>{sub}</div>
            </div>
          </motion.div>
        </motion.div>
      ))}

      {/* Ambient glow under card */}
      <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-3/4 h-16 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse, rgba(255,0,64,0.18) 0%, transparent 70%)', filter: 'blur(16px)' }} />
    </div>
  );
}
