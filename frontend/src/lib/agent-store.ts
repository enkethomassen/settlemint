// In-memory store for agent settings (persists across warm invocations)

export interface AgentSettingsRecord {
  address: string;
  mode: "safe" | "autopilot";
  spendingCap: number;
  spendingUsed: number;
  spendingReset: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __agentStore: Map<string, AgentSettingsRecord> | undefined;
}

if (!global.__agentStore) {
  global.__agentStore = new Map();
}

export const agentStore = global.__agentStore;

export function getSettings(address: string): AgentSettingsRecord {
  if (!agentStore.has(address)) {
    agentStore.set(address, {
      address,
      mode: "safe",
      spendingCap: 1000,
      spendingUsed: 0,
      spendingReset: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
  }
  return agentStore.get(address)!;
}

export function formatSettings(s: AgentSettingsRecord) {
  const capRemaining = Math.max(0, s.spendingCap - s.spendingUsed);
  const capUsedPct = s.spendingCap > 0 ? Math.round((s.spendingUsed / s.spendingCap) * 100) : 0;
  return { ...s, capRemaining, capUsedPct };
}
