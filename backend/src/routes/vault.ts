/**
 * routes/vault.ts — Vault API endpoints
 */

import { Router, Request, Response } from "express";
import { ethers } from "ethers";
import { logger } from "../logger";
import {
  getUserPayments,
  getVaultInfo,
  seedMockUser,
  addMockPayment,
  cancelMockPayment,
  OnChainPayment,
} from "../services/vaultService";
import {
  registerUser,
  getRegisteredUsers,
  getSchedulerStatus,
  triggerNow,
} from "../agents/scheduler";
import { getExecutionLog, getExecutionStats } from "../agents/paymentExecutor";
import { getSpendingStats } from "../x402/client";

const router = Router();

// ─── Vault Info ─────────────────────────────────────────────────────────────

router.get("/vault/:address", async (req: Request, res: Response) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid address" });
  }

  try {
    const [payments, vaultInfo] = await Promise.all([
      getUserPayments(address),
      getVaultInfo(address),
    ]);

    const formattedPayments = payments.map((p, i) => ({
      id: i,
      recipient: p.recipient,
      amount: ethers.formatEther(p.amount),
      interval: Number(p.interval),
      lastExecuted: Number(p.lastExecuted),
      isActive: p.isActive,
      isX402: p.isX402,
      endpoint: p.endpoint,
      nextExecution:
        p.lastExecuted === 0n
          ? "NOW"
          : new Date((Number(p.lastExecuted) + Number(p.interval)) * 1000).toISOString(),
    }));

    res.json({
      address,
      collateral: ethers.formatEther(vaultInfo.collateral),
      musdBalance: ethers.formatEther(vaultInfo.musdBalance),
      collateralRatio: Number(vaultInfo.collateralRatio),
      payments: formattedPayments,
    });
  } catch (err: any) {
    logger.error("GET /vault/:address failed", { address, error: err.message });
    res.status(500).json({ error: "Failed to fetch vault info" });
  }
});

// ─── Payment Creation (demo mode) ────────────────────────────────────────────

router.post("/payments", async (req: Request, res: Response) => {
  const { address, recipient, amount, interval, isX402, endpoint } = req.body;

  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid or missing address" });
  }
  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }
  if (!interval || isNaN(Number(interval)) || Number(interval) < 60) {
    return res.status(400).json({ error: "Interval must be >= 60 seconds" });
  }
  if (!isX402 && (!recipient || !ethers.isAddress(recipient))) {
    return res.status(400).json({ error: "Valid recipient address required for wallet payments" });
  }
  if (isX402 && (!endpoint || !endpoint.startsWith("http"))) {
    return res.status(400).json({ error: "Valid x402 endpoint URL required" });
  }

  // In live mode, this should be done on-chain via the frontend's wagmi write
  if (process.env.VAULT_CONTRACT_ADDRESS) {
    return res.status(400).json({
      error: "In live mode, payments must be scheduled on-chain via the frontend",
    });
  }

  const payment: OnChainPayment = {
    recipient: isX402 ? ethers.ZeroAddress : recipient,
    amount: ethers.parseEther(String(amount)),
    interval: BigInt(Number(interval)),
    lastExecuted: 0n,
    isActive: true,
    isX402: Boolean(isX402),
    endpoint: isX402 ? endpoint : "",
  };

  const paymentId = addMockPayment(address, payment);
  registerUser(address);

  logger.info("Payment created via API", { address, paymentId, amount, isX402 });
  res.json({ success: true, paymentId, message: "Payment scheduled in demo mode" });
});

// ─── Payment Cancellation (demo mode) ────────────────────────────────────────

router.post("/payments/cancel", async (req: Request, res: Response) => {
  const { address, paymentId } = req.body;

  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid or missing address" });
  }
  if (paymentId === undefined || isNaN(Number(paymentId))) {
    return res.status(400).json({ error: "Invalid paymentId" });
  }

  if (process.env.VAULT_CONTRACT_ADDRESS) {
    return res.status(400).json({ error: "In live mode, cancellation must be done on-chain" });
  }

  const ok = cancelMockPayment(address, Number(paymentId));
  if (!ok) return res.status(404).json({ error: "Payment not found or already cancelled" });

  logger.info("Payment cancelled via API", { address, paymentId });
  res.json({ success: true });
});

// ─── User Registration ───────────────────────────────────────────────────────

router.post("/users/register", (req: Request, res: Response) => {
  const { address } = req.body;
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid address" });
  }

  registerUser(address);
  seedMockUser(address);
  res.json({ success: true, address, message: "Registered for scheduler" });
});

router.get("/users", (_req: Request, res: Response) => {
  res.json({ users: getRegisteredUsers() });
});

// ─── Scheduler ──────────────────────────────────────────────────────────────

router.get("/scheduler/status", (_req: Request, res: Response) => {
  res.json(getSchedulerStatus());
});

router.post("/scheduler/trigger", async (_req: Request, res: Response) => {
  logger.info("Manual scheduler trigger via API");
  triggerNow().catch((err) => logger.error("Manual trigger failed", { error: err.message }));
  res.json({ message: "Scheduler triggered — check logs for results" });
});

// ─── Payments Log ────────────────────────────────────────────────────────────

router.get("/payments/log", (_req: Request, res: Response) => {
  const log = getExecutionLog();
  res.json({
    log: log.map((entry) => ({
      ...entry,
      amount: ethers.formatEther(entry.amount || "0"),
      date: new Date(entry.timestamp).toISOString(),
    })),
  });
});

router.get("/payments/stats", (_req: Request, res: Response) => {
  const stats = getExecutionStats();
  const spending = getSpendingStats();
  res.json({ ...stats, x402Spending: spending });
});

// ─── x402 Simulation ────────────────────────────────────────────────────────

router.post("/x402/simulate", async (req: Request, res: Response) => {
  const { url, walletAddress, amount } = req.body;

  if (!url || !walletAddress || !amount) {
    return res.status(400).json({ error: "url, walletAddress, and amount are required" });
  }

  try {
    const { simulateX402Payment } = await import("../x402/client");
    const result = await simulateX402Payment(url, walletAddress, amount);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health ──────────────────────────────────────────────────────────────────

router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    mode: process.env.VAULT_CONTRACT_ADDRESS ? "live" : "demo",
    walletIntelligence: {
      aiProvider: process.env.AI_PROVIDER ?? "none",
      evmSource: process.env.ALCHEMY_URL ? "alchemy" : "blockscout-public",
      btcSource: process.env.BTC_ESPLORA_BASE ?? "mempool.space",
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
