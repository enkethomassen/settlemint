// In-memory store: Telegram chat ID → linked Mezo wallet address
declare global {
  // eslint-disable-next-line no-var
  var __telegramStore: Map<number, string> | undefined;
}
if (!global.__telegramStore) {
  global.__telegramStore = new Map();
}
export const telegramStore = global.__telegramStore;
