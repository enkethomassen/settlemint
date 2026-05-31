import type { ElementType } from 'react';
import {
  LayoutDashboard, Vault, Plus, List,
  TrendingUp, Zap, Activity, Settings2,
} from 'lucide-react';
import type { Tab } from './types';

export const NAV_GROUPS: {
  label: string;
  items: { id: Tab; label: string; icon: ElementType; tag?: string }[];
}[] = [
  {
    label: 'Treasury',
    items: [
      { id: 'dashboard', label: 'Overview',      icon: LayoutDashboard },
      { id: 'vault',     label: 'Vault',          icon: Vault },
      { id: 'yield',     label: 'Yield',          icon: TrendingUp,      tag: 'YIELD' },
    ],
  },
  {
    label: 'Payments',
    items: [
      { id: 'create',   label: 'New Payment',    icon: Plus },
      { id: 'payments', label: 'Schedules',       icon: List },
      { id: 'x402',     label: 'x402 Monitor',   icon: Zap,             tag: 'X402' },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'agent',    label: 'Agent',           icon: Activity,    tag: 'LIVE' },
      { id: 'settings', label: 'Agent Policy',    icon: Settings2,   tag: 'AGENT' },
    ],
  },
];
