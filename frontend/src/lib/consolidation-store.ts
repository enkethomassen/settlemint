// In-memory store for end-of-month consolidation requests.
// Mirrors the demo-store / agent-store pattern: persists within a warm
// serverless instance, resets on cold start. No fake swaps are ever recorded —
// a request captures real balances + prices and an honest queued/pending status.

export interface ConsolidationItem {
  contract: string;
  symbol: string;
  balance: number;
  estimatedMUSD: number;
}

export type ConsolidationStatus = "pending_approval" | "queued" | "cancelled";

export interface ConsolidationRequest {
  id: number;
  address: string;
  mode: "safe" | "autopilot";
  schedule: "now" | "month_end";
  scheduledFor: number; // unix ms
  status: ConsolidationStatus;
  items: ConsolidationItem[];
  totalMUSD: number;
  createdAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __consolidationStore:
    | { requests: Map<string, ConsolidationRequest[]>; nextId: number }
    | undefined;
}

if (!global.__consolidationStore) {
  global.__consolidationStore = { requests: new Map(), nextId: 1 };
}

export const consolidationStore = global.__consolidationStore;

export function getRequests(address: string): ConsolidationRequest[] {
  const key = address.toLowerCase();
  if (!consolidationStore.requests.has(key)) {
    consolidationStore.requests.set(key, []);
  }
  return consolidationStore.requests.get(key)!;
}

export function addRequest(req: ConsolidationRequest): void {
  getRequests(req.address).unshift(req);
}
