// In-memory tag store for transaction labels

export interface TagRecord {
  id: string;
  txHash: string;
  walletAddress: string;
  userTag: string;
  category: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __tagStore: Map<string, TagRecord> | undefined;
}

if (!global.__tagStore) {
  global.__tagStore = new Map();
}

export const tagStore = global.__tagStore;
