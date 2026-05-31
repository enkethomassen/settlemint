'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingDown, TrendingUp, Calendar, AlertTriangle, Zap } from 'lucide-react';
import { formatMUSD, formatInterval, type PaymentData } from '@/lib/api';

const E: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface ForecastDay {
  date: Date;
  label: string;
  outflow: number;
  payments: { id: number; recipient: string; amount: number; isX402: boolean }[];
}

function buildForecast(payments: PaymentData[], days = 30): ForecastDay[] {
  const now = Date.now();
  const result: ForecastDay[] = [];

  for (let i = 0; i < days; i++) {
    const date = new Date(now + i * 86400_000);
    date.setHours(0, 0, 0, 0);
    const dayStart = date.getTime() / 1000;
    const dayEnd = dayStart + 86400;
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const due: ForecastDay['payments'] = [];

    for (const p of payments) {
      if (!p.isActive) continue;
      const interval = Number(p.interval);
      if (interval <= 0) continue;

      const lastEx = Number(p.lastExecuted);
      const amount = parseFloat(p.amount);
      if (isNaN(amount)) continue;

      // Find all execution times that land in this day
      let next = lastEx === 0 ? dayStart : lastEx + interval;
      while (next < dayEnd) {
        if (next >= dayStart) {
          due.push({ id: p.id, recipient: p.recipient || p.endpoint, amount, isX402: p.isX402 });
          break; // one occurrence per payment per day
        }
        next += interval;
      }
    }

    result.push({
      date,
      label,
      outflow: due.reduce((s, p) => s + p.amount, 0),
      payments: due,
    });
  }

  return result;
}

export default function CashflowForecast({ payments, musdBalance }: {
  payments: PaymentData[];
  musdBalance: number;
}) {
  const forecast = useMemo(() => buildForecast(payments), [payments]);

  const maxOutflow = Math.max(...forecast.map(d => d.outflow), 1);
  const totalOut30 = forecast.reduce((s, d) => s + d.outflow, 0);
  const avgDaily = totalOut30 / 30;
  const daysRunway = avgDaily > 0 ? Math.floor(musdBalance / avgDaily) : Infinity;

  const activeDays = forecast.filter(d => d.outflow > 0);

  const runwayColor = daysRunway < 7 ? '#ef4444' : daysRunway < 30 ? '#f59e0b' : '#22c55e';

  return (
    <div className="card-base p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: '1.05rem', letterSpacing: '-0.025em' }}>
            30-Day Cashflow Forecast
          </h3>
          <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Projected MUSD outflows from active payment schedules
          </p>
        </div>
        <Calendar className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: '30-day total',
            value: `${formatMUSD(totalOut30)} MUSD`,
            icon: TrendingDown,
            color: '#ef4444',
          },
          {
            label: 'Avg daily burn',
            value: `${formatMUSD(avgDaily)} MUSD`,
            icon: Zap,
            color: '#F7931A',
          },
          {
            label: 'Est. runway',
            value: daysRunway === Infinity ? '∞ days' : `${daysRunway} days`,
            icon: daysRunway < 30 ? AlertTriangle : TrendingUp,
            color: runwayColor,
          },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-[14px] p-4"
            style={{ background: 'var(--bg-raised)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Icon className="h-3.5 w-3.5" style={{ color }} />
              <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
                {label}
              </p>
            </div>
            <p className="font-bold font-mono text-[15px]" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Bar chart — 30 days */}
      {totalOut30 > 0 ? (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] mb-3" style={{ color: 'var(--text-muted)' }}>
            Daily outflow
          </p>
          <div className="flex items-end gap-[3px] h-20">
            {forecast.map((day, i) => {
              const heightPct = day.outflow > 0 ? (day.outflow / maxOutflow) * 100 : 0;
              const isToday = i === 0;
              const hasPayments = day.outflow > 0;

              return (
                <div key={i} className="group relative flex-1 flex flex-col items-center justify-end h-full">
                  {hasPayments && (
                    // Tooltip
                    <div className="pointer-events-none absolute bottom-full mb-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                      style={{ minWidth: 130 }}>
                      <div className="rounded-xl px-3 py-2.5 text-[11px]"
                        style={{ background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                        <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{day.label}</p>
                        <p className="font-mono" style={{ color: '#F7931A' }}>{formatMUSD(day.outflow)} MUSD</p>
                        {day.payments.map(p => (
                          <p key={p.id} className="mt-0.5 truncate" style={{ color: 'var(--text-muted)', maxWidth: 150 }}>
                            · {p.isX402 ? '⚡ x402' : p.recipient.slice(0, 8) + '…'} {formatMUSD(p.amount)}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${heightPct}%` }}
                    transition={{ duration: 0.5, ease: E, delay: i * 0.012 }}
                    className="w-full rounded-t-[3px]"
                    style={{
                      background: hasPayments
                        ? isToday
                          ? 'linear-gradient(180deg, #F7931A, #F7931Acc)'
                          : 'linear-gradient(180deg, rgba(247,147,26,0.6), rgba(247,147,26,0.3))'
                        : 'transparent',
                      minHeight: hasPayments ? 2 : 0,
                    }}
                  />
                  {(i % 7 === 0 || i === 0) && (
                    <p className="absolute -bottom-5 text-[8px] font-mono whitespace-nowrap"
                      style={{ color: 'var(--text-muted)' }}>
                      {isToday ? 'Today' : day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="h-5" /> {/* spacer for date labels */}
        </div>
      ) : (
        <div className="flex items-center justify-center py-8 rounded-[14px]"
          style={{ background: 'var(--bg-raised)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No active payments scheduled</p>
        </div>
      )}

      {/* Upcoming payments list */}
      {activeDays.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] mb-3" style={{ color: 'var(--text-muted)' }}>
            Upcoming payment dates
          </p>
          <div className="space-y-2">
            {activeDays.slice(0, 6).map((day) => (
              <div key={day.date.toISOString()}
                className="flex items-center gap-4 rounded-xl px-4 py-3"
                style={{ background: 'var(--bg-raised)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="shrink-0 w-12 text-center">
                  <p className="text-[18px] font-bold font-mono leading-none"
                    style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                    {day.date.getDate()}
                  </p>
                  <p className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    {day.date.toLocaleDateString('en-US', { month: 'short' })}
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  {day.payments.map(p => (
                    <div key={p.id} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: '#F7931A' }} />
                      <p className="text-[12.5px] truncate" style={{ color: 'var(--text-secondary)' }}>
                        {p.isX402 ? `x402 · ${p.recipient.slice(0, 24)}…` : `${p.recipient.slice(0, 8)}…${p.recipient.slice(-4)}`}
                      </p>
                      <p className="ml-auto shrink-0 text-[12px] font-mono font-bold" style={{ color: '#F7931A' }}>
                        {formatMUSD(p.amount)}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="shrink-0 text-[12px] font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                  {formatMUSD(day.outflow)} MUSD
                </p>
              </div>
            ))}
          </div>
          {activeDays.length > 6 && (
            <p className="mt-2 text-center text-[11px]" style={{ color: 'var(--text-muted)' }}>
              +{activeDays.length - 6} more days with scheduled payments
            </p>
          )}
        </div>
      )}

      {/* Runway warning */}
      {daysRunway < 30 && daysRunway !== Infinity && (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 rounded-[14px] p-4"
          style={{
            background: daysRunway < 7 ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
            border: `1px solid ${daysRunway < 7 ? 'rgba(239,68,68,0.22)' : 'rgba(245,158,11,0.22)'}`,
          }}>
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0"
            style={{ color: daysRunway < 7 ? '#ef4444' : '#f59e0b' }} />
          <div>
            <p className="text-[13px] font-semibold mb-0.5"
              style={{ color: daysRunway < 7 ? '#ef4444' : '#f59e0b' }}>
              {daysRunway < 7 ? 'Critical: low runway' : 'Runway below 30 days'}
            </p>
            <p className="text-[12px] leading-[1.7]" style={{ color: 'var(--text-secondary)' }}>
              At current burn rate your MUSD balance covers approximately {daysRunway} days.
              Consider minting additional MUSD or pausing non-critical payments.
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
}
