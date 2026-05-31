/**
 * routes/wallet.ts
 * Wallet analysis API — ACE-Protocol-style pipeline (heuristics + optional LLM).
 * Supports EVM (Alchemy) and Bitcoin (Esplora) address types.
 */

import { Router, Request, Response } from "express";
import { ethers } from "ethers";
import { logger } from "../logger";
import { scanWallet, getTxs, buildInsights } from "../wallet/pipeline";
import { summarize } from "../wallet/ai/summary";
import { walletConfig } from "../wallet/config";
import { upsertTag, getTagsByWallet, deleteTag } from "../services/tagDb";

const router = Router();

// ─── POST /api/wallet/scan ────────────────────────────────────────────────────
// Fetch, categorize, store, and return transactions + insights for a wallet.

router.post("/scan", async (req: Request, res: Response) => {
  const { address, chain } = req.body as { address?: string; chain?: string };

  if (!address) return res.status(400).json({ error: "address is required" });

  // Auto-detect chain if omitted
  let detectedChain = chain as "evm" | "btc" | undefined;
  if (!detectedChain) {
    if (/^0x[a-fA-F0-9]{40}$/.test(address)) detectedChain = "evm";
    else if (
      /^(1|3)[a-zA-HJ-NP-Z0-9]{25,34}$/.test(address) ||
      /^bc1[a-zA-HJ-NP-Z0-9]{6,87}$/.test(address)
    ) detectedChain = "btc";
    else return res.status(400).json({ error: "Cannot detect chain. Provide chain: 'evm' | 'btc'" });
  }

  if (detectedChain === "evm" && !ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid EVM address" });
  }

  try {
    logger.info("Wallet scan started", { address, chain: detectedChain });
    const result = await scanWallet(address, detectedChain);
    logger.info("Wallet scan complete", { address, txCount: result.transactions.length });
    res.json(result);
  } catch (err: any) {
    logger.error("Wallet scan failed", { address, error: err.message });
    res.status(500).json({ error: err.message || "Scan failed" });
  }
});

// ─── GET /api/wallet/transactions/:address ────────────────────────────────────
// Return categorized transactions from the local store (no re-fetch).

router.get("/transactions/:address", (req: Request, res: Response) => {
  const { address } = req.params;
  const limit = parseInt(req.query.limit as string) || 500;
  try {
    const transactions = getTxs(address, limit);
    res.json({ address, count: transactions.length, transactions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/wallet/insights/:address ───────────────────────────────────────
// Return dashboard aggregates from the local store.

router.get("/insights/:address", (req: Request, res: Response) => {
  const { address } = req.params;
  const chain = (req.query.chain as string) || "evm";

  if (chain !== "evm" && chain !== "btc") {
    return res.status(400).json({ error: "chain query param must be 'evm' or 'btc'" });
  }

  try {
    const txs = getTxs(address, 1000);
    const insights = buildInsights(address, chain as "evm" | "btc", txs);
    res.json(insights);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/wallet/summary/:address ────────────────────────────────────────
// Return a natural-language treasury summary.

router.get("/summary/:address", async (req: Request, res: Response) => {
  const { address } = req.params;
  const chain = (req.query.chain as string) || "evm";

  if (chain !== "evm" && chain !== "btc") {
    return res.status(400).json({ error: "chain query param must be 'evm' or 'btc'" });
  }

  try {
    const txs = getTxs(address, 1000);
    const insights = buildInsights(address, chain as "evm" | "btc", txs);
    const summary = await summarize(insights);
    res.json({ address, summary, insights });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/wallet/analyze ─────────────────────────────────────────────────
// Alias for /scan that also accepts the old addressType param for compatibility.

router.post("/analyze", async (req: Request, res: Response) => {
  const { address, addressType, chain } = req.body as {
    address?: string;
    addressType?: "evm" | "bitcoin";
    chain?: "evm" | "btc";
  };

  if (!address) return res.status(400).json({ error: "address is required" });

  // Map legacy "bitcoin" to "btc"
  let resolvedChain: "evm" | "btc" | undefined = chain;
  if (!resolvedChain && addressType) {
    resolvedChain = addressType === "bitcoin" ? "btc" : "evm";
  }
  if (!resolvedChain) {
    if (/^0x[a-fA-F0-9]{40}$/.test(address)) resolvedChain = "evm";
    else if (/^(1|3)[a-zA-HJ-NP-Z0-9]{25,34}$/.test(address) || /^bc1[a-zA-HJ-NP-Z0-9]{6,87}$/.test(address))
      resolvedChain = "btc";
    else return res.status(400).json({ error: "Cannot detect chain type. Provide chain or addressType." });
  }

  try {
    logger.info("Wallet analysis started", { address, chain: resolvedChain });
    const result = await scanWallet(address, resolvedChain);
    logger.info("Wallet analysis complete", { address, txCount: result.transactions.length });
    // Return in the legacy shape the frontend expects
    res.json({
      address,
      addressType: resolvedChain === "btc" ? "bitcoin" : "evm",
      transactions: result.transactions,
      insights: result.insights,
      aiProvider: walletConfig.ai.provider,
    });
  } catch (err: any) {
    logger.error("Wallet analysis failed", { address, error: err.message });
    res.status(500).json({ error: err.message || "Analysis failed" });
  }
});

// ─── POST /api/wallet/tag ─────────────────────────────────────────────────────

router.post("/tag", (req: Request, res: Response) => {
  const { txHash, walletAddress, tag, category } = req.body as {
    txHash?: string;
    walletAddress?: string;
    tag?: string;
    category?: string;
  };

  if (!txHash || !walletAddress || !tag) {
    return res.status(400).json({ error: "txHash, walletAddress, and tag are required" });
  }

  try {
    const result = upsertTag(txHash, walletAddress, tag, category ?? "unknown");
    res.json({ success: true, tag: result });
  } catch (err: any) {
    logger.error("Tag upsert failed", { txHash, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/wallet/tags ─────────────────────────────────────────────────────

router.get("/tags", (req: Request, res: Response) => {
  const { address } = req.query as { address?: string };
  if (!address) return res.status(400).json({ error: "address query param required" });

  try {
    const tags = getTagsByWallet(address);
    res.json({ tags });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/wallet/tag/:txHash ──────────────────────────────────────────

router.delete("/tag/:txHash", (req: Request, res: Response) => {
  const { txHash } = req.params;
  const { walletAddress } = req.body as { walletAddress?: string };

  if (!walletAddress) return res.status(400).json({ error: "walletAddress required in body" });

  const deleted = deleteTag(txHash, walletAddress);
  if (!deleted) return res.status(404).json({ error: "Tag not found" });
  res.json({ success: true });
});

export default router;
