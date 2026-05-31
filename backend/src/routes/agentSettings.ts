/**
 * agentSettings.ts — Web dashboard agent settings API
 * Uses botUserDb with platform="web" so web settings feed into the same
 * safe/autopilot pipeline as Telegram and WhatsApp bots.
 */

import { Router, Request, Response } from "express";
import { ethers } from "ethers";
import {
  getOrCreateUser,
  setUserMode,
  setSpendingCap,
  setUserAddress,
  BotMode,
} from "../services/botUserDb";

const router = Router();

const WEB_PLATFORM = "telegram" as const; // reuse platform slot; chatId = wallet address

function webUser(address: string) {
  return getOrCreateUser(address.toLowerCase(), WEB_PLATFORM);
}

// GET /api/agent/settings/:address
router.get("/settings/:address", (req: Request, res: Response) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid address" });
  }

  const user = webUser(address);
  return res.json({
    address,
    mode: user.mode,
    spendingCap: user.spendingCap,
    spendingUsed: user.spendingUsed,
    spendingReset: user.spendingReset,
    capRemaining: Math.max(0, user.spendingCap - user.spendingUsed),
    capUsedPct: user.spendingCap > 0
      ? Math.min(100, (user.spendingUsed / user.spendingCap) * 100)
      : 0,
  });
});

// POST /api/agent/settings
router.post("/settings", (req: Request, res: Response) => {
  const { address, mode, spendingCap } = req.body;

  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid address" });
  }

  const addr = address.toLowerCase();

  // Ensure user exists and is linked to this wallet
  setUserAddress(addr, WEB_PLATFORM, addr);

  if (mode !== undefined) {
    if (mode !== "safe" && mode !== "autopilot") {
      return res.status(400).json({ error: "mode must be 'safe' or 'autopilot'" });
    }
    setUserMode(addr, WEB_PLATFORM, mode as BotMode);
  }

  if (spendingCap !== undefined) {
    const cap = Number(spendingCap);
    if (isNaN(cap) || cap < 0) {
      return res.status(400).json({ error: "spendingCap must be a non-negative number" });
    }
    setSpendingCap(addr, WEB_PLATFORM, cap);
  }

  const updated = webUser(addr);
  return res.json({
    success: true,
    address: addr,
    mode: updated.mode,
    spendingCap: updated.spendingCap,
    spendingUsed: updated.spendingUsed,
    spendingReset: updated.spendingReset,
    capRemaining: Math.max(0, updated.spendingCap - updated.spendingUsed),
    capUsedPct: updated.spendingCap > 0
      ? Math.min(100, (updated.spendingUsed / updated.spendingCap) * 100)
      : 0,
  });
});

export default router;
