const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export interface VaultData {
  address: string;
  collateral: string;
  musdBalance: string;
  collateralRatio: number;
  payments: PaymentData[];
}

export interface PaymentData {
  id: number;
  recipient: string;
  amount: string;
  interval: number;
  lastExecuted: number;
  isActive: boolean;
  isX402: boolean;
  endpoint: string;
  nextExecution: string;
}

export interface ExecutionLogEntry {
  success: boolean;
  type: "wallet" | "x402";
  txHash?: string;
  error?: string;
  userAddress: string;
  paymentId: number;
  amount: string;
  timestamp: number;
  date: string;
  x402Result?: {
    paidAmount?: string;
    endpoint?: string;
  };
}

export interface PaymentStats {
  total: number;
  successful: number;
  failed: number;
  walletPayments: number;
  x402Payments: number;
  totalMUSD: number;
  x402Spending: Record<string, number>;
}

export interface SchedulerStatus {
  running: boolean;
  lastRun: string | null;
  registeredUsers: number;
  totalChecked: number;
  totalExecuted: number;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  getVault: (address: string) =>
    apiFetch<VaultData>(`/api/vault/${address}`),

  registerUser: (address: string) =>
    apiFetch<{ success: boolean }>("/api/users/register", {
      method: "POST",
      body: JSON.stringify({ address }),
    }),

  getSchedulerStatus: () =>
    apiFetch<SchedulerStatus>("/api/scheduler/status"),

  triggerScheduler: () =>
    apiFetch<{ message: string }>("/api/scheduler/trigger", { method: "POST" }),

  getPaymentLog: () =>
    apiFetch<{ log: ExecutionLogEntry[] }>("/api/payments/log"),

  getPaymentStats: () =>
    apiFetch<PaymentStats>("/api/payments/stats"),

  simulateX402: (url: string, walletAddress: string, amount: string) =>
    apiFetch<{ success: boolean; txHash?: string; error?: string }>("/api/x402/simulate", {
      method: "POST",
      body: JSON.stringify({ url, walletAddress, amount }),
    }),

  health: () =>
    apiFetch<{ status: string; mode: string }>("/api/health").catch(() => {
      throw new Error("Backend offline");
    }),
};

export const INTERVAL_OPTIONS = [
  { label: "Every minute (test)", value: 60 },
  { label: "Hourly", value: 3600 },
  { label: "Daily", value: 86400 },
  { label: "Weekly", value: 604800 },
  { label: "Monthly", value: 2592000 },
];

export function formatInterval(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.round(seconds / 86400)}d`;
  if (seconds < 2592000) return `${Math.round(seconds / 604800)}w`;
  return `${Math.round(seconds / 2592000)}mo`;
}

export function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatMUSD(amount: string | number): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export interface CreatePaymentPayload {
  address: string;
  recipient?: string;
  amount: string;
  interval: number;
  isX402: boolean;
  endpoint?: string;
}

export const apiExtra = {
  createPayment: (payload: CreatePaymentPayload) =>
    apiFetch<{ success: boolean; paymentId: number; message: string }>("/api/payments", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  cancelPayment: (address: string, paymentId: number) =>
    apiFetch<{ success: boolean }>("/api/payments/cancel", {
      method: "POST",
      body: JSON.stringify({ address, paymentId }),
    }),
};

// ─── Wallet Analyzer types ────────────────────────────────────────────────────

export type TransactionCategory =
  | "payment" | "subscription" | "yield" | "swap"
  | "gas" | "transfer" | "stablecoin" | "nft" | "unknown";

export interface WalletTransaction {
  hash: string;
  timestamp: number;
  from: string;
  to: string;
  amount: number;
  amountUSD: number;
  token: string;
  category: TransactionCategory;
  isFiltered: boolean;
  filterReason?: string;
  userTag?: string;
  predictedTag?: string;
  confidence?: number;
}

export interface RecurringPayment {
  toAddress: string;
  toLabel?: string;
  amount: number;
  amountUSD: number;
  token: string;
  frequency: "daily" | "weekly" | "monthly" | "irregular";
  confidence: number;
  nextExpected?: string;
  occurrences: number;
  totalSpent: number;
}

export interface CategoryBreakdown {
  category: string;
  amountUSD: number;
  percentage: number;
}

export interface WalletAnalysis {
  address: string;
  addressType: "evm" | "bitcoin";
  range: string;
  totalOutflow: number;
  totalInflow: number;
  monthlyBurn: number;
  runway: string;
  reserveScore: number;
  transactions: WalletTransaction[];
  recurringPayments: RecurringPayment[];
  spendByCategory: CategoryBreakdown[];
  aiInsights: string[];
  topRecipients: { address: string; label?: string; totalUSD: number; count: number }[];
}

export interface TransactionTag {
  id: string;
  txHash: string;
  walletAddress: string;
  userTag: string;
  category: string;
  createdAt: number;
}

// ─── Agent Settings ───────────────────────────────────────────────────────────

export interface AgentSettings {
  address: string;
  mode: 'safe' | 'autopilot';
  spendingCap: number;
  spendingUsed: number;
  spendingReset: number;
  capRemaining: number;
  capUsedPct: number;
}

export const agentApi = {
  getSettings: (address: string) =>
    apiFetch<AgentSettings>(`/api/agent/settings/${address}`),

  updateSettings: (address: string, mode?: 'safe' | 'autopilot', spendingCap?: number) =>
    apiFetch<AgentSettings & { success: boolean }>('/api/agent/settings', {
      method: 'POST',
      body: JSON.stringify({ address, mode, spendingCap }),
    }),
};

export const walletApi = {
  analyze: (address: string, addressType?: "evm" | "bitcoin", range: "30d" | "90d" | "180d" = "90d") =>
    apiFetch<WalletAnalysis>("/api/wallet/analyze", {
      method: "POST",
      body: JSON.stringify({ address, addressType, range }),
    }),

  addTag: (txHash: string, walletAddress: string, tag: string, category?: string) =>
    apiFetch<{ success: boolean; tag: TransactionTag }>("/api/wallet/tag", {
      method: "POST",
      body: JSON.stringify({ txHash, walletAddress, tag, category }),
    }),

  getTags: (address: string) =>
    apiFetch<{ tags: TransactionTag[] }>(`/api/wallet/tags?address=${encodeURIComponent(address)}`),

  deleteTag: (txHash: string, walletAddress: string) =>
    apiFetch<{ success: boolean }>(`/api/wallet/tag/${txHash}`, {
      method: "DELETE",
      body: JSON.stringify({ walletAddress }),
    }),
};
