// Wallet intelligence config — reads from the same .env as the main backend.
// All fields are optional so the pipeline boots even with partial setup;
// adapters throw a clear error only when actually invoked without their key.
export const walletConfig = {
  // Full Alchemy network URL, e.g. https://eth-mainnet.g.alchemy.com/v2/KEY
  alchemyUrl: process.env.ALCHEMY_URL ?? "",
  evmNetwork: process.env.EVM_NETWORK ?? "ethereum",

  // Esplora REST API (free, no key). mempool.space or blockstream.info
  btcEsploraBase: process.env.BTC_ESPLORA_BASE ?? "https://mempool.space/api",

  // CoinGecko (free). Optional demo key removes the 30 req/min cap.
  coingeckoBase: process.env.COINGECKO_BASE ?? "https://api.coingecko.com/api/v3",
  coingeckoKey: process.env.COINGECKO_KEY ?? "",

  // SQLite path for wallet tx store
  dbPath: process.env.WALLET_DB_PATH ?? "./data/wallet-intel.db",

  ai: {
    // groq | gemini | ollama | openai | none
    provider: (process.env.AI_PROVIDER ?? "none") as
      | "groq" | "gemini" | "ollama" | "openai" | "none",
    apiKey: process.env.AI_API_KEY ?? "",
    model: process.env.AI_MODEL ?? "",
    ollamaBase: process.env.OLLAMA_BASE ?? "http://localhost:11434",
    confidenceThreshold: Number(process.env.AI_CONFIDENCE_THRESHOLD ?? 0.7),
  },
};
