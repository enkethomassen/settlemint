// Shared in-memory demo store for serverless API routes.
// State persists within a warm function instance; resets on cold start.

export interface DemoPayment {
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

export interface DemoUser {
  address: string;
  payments: DemoPayment[];
}

declare global {
  // eslint-disable-next-line no-var
  var __demoStore: {
    users: Map<string, DemoUser>;
    log: any[];
    nextId: number;
  } | undefined;
}

if (!global.__demoStore) {
  global.__demoStore = { users: new Map(), log: [], nextId: 1 };
}

export const store = global.__demoStore;

export function getUser(address: string): DemoUser {
  if (!store.users.has(address)) {
    store.users.set(address, { address, payments: [] });
  }
  return store.users.get(address)!;
}
