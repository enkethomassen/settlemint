/**
 * scheduler.ts — Payment Scheduler with Safe/Autopilot mode support
 *
 * Runs every minute. For each registered user's due payments:
 *   - Autopilot mode: auto-execute if within monthly spending cap
 *   - Safe mode:      send approval request to user's bot(s) and wait
 */

import cron from "node-cron";
import { ethers } from "ethers";
import { logger } from "../logger";
import {
  getUserPayments,
  getVaultInfo,
  seedMockUser,
  getAllMockUsers,
  updateMockPaymentLastExecuted,
} from "../services/vaultService";
import { executePayment } from "./paymentExecutor";
import {
  getAutopilotUsersForAddress,
  getAllSafeUsers,
  canAutopilotSpend,
  recordSpending,
  createPendingApproval,
  BotUser,
} from "../services/botUserDb";
import {
  sendSafeApprovalRequest,
  sendAutopilotNotification,
  sendCapExceededAlert,
} from "../bots/telegramBot";
import {
  sendWaSafeApprovalRequest,
  sendWaAutopilotNotification,
  sendWaCapExceeded,
} from "../bots/whatsappBot";

const registeredUsers = new Set<string>();

export function registerUser(address: string) {
  registeredUsers.add(address.toLowerCase());
  if (!process.env.VAULT_CONTRACT_ADDRESS) seedMockUser(address);
  logger.info("User registered with scheduler", { address });
}

export function getRegisteredUsers(): string[] {
  return Array.from(registeredUsers);
}

let schedulerRunning = false;
let lastRun: Date | null = null;
let totalChecked = 0;
let totalExecuted = 0;

export function getSchedulerStatus() {
  return {
    running: schedulerRunning,
    lastRun: lastRun?.toISOString() || null,
    registeredUsers: registeredUsers.size,
    totalChecked,
    totalExecuted,
  };
}

async function processPayment(
  userAddress: string,
  paymentId: number,
  amountMusd: number,
  recipient: string,
  botUsers: BotUser[],
  rawPayment: any
): Promise<void> {
  // Check each bot user's mode
  const autopilotUsers = botUsers.filter((u) => u.mode === "autopilot");
  const safeUsers = botUsers.filter((u) => u.mode === "safe");

  // ── AUTOPILOT PATH ──────────────────────────────────────────────────────────
  for (const user of autopilotUsers) {
    if (canAutopilotSpend(user, amountMusd)) {
      logger.info("Autopilot: executing payment", { userAddress, paymentId, amountMusd });

      const result = await executePayment(userAddress, paymentId, rawPayment);

      if (result.success) {
        recordSpending(user.chatId, user.platform, amountMusd);
        const updatedUsed = user.spendingUsed + amountMusd;

        // Notify user
        if (user.platform === "telegram") {
          sendAutopilotNotification(
            user.chatId, amountMusd, recipient, result.txHash ?? "mock",
            updatedUsed, user.spendingCap
          ).catch(() => {});
        } else if (user.platform === "whatsapp") {
          sendWaAutopilotNotification(
            user.chatId, amountMusd, recipient, result.txHash ?? "mock",
            updatedUsed, user.spendingCap
          ).catch(() => {});
        }

        totalExecuted++;
        updateMockPaymentLastExecuted(userAddress, paymentId, Math.floor(Date.now() / 1000));
      } else {
        logger.error("Autopilot payment failed", { userAddress, paymentId, error: result.error });
      }
    } else {
      // Cap exceeded — alert user
      logger.warn("Autopilot cap exceeded", { userAddress, paymentId, amountMusd, cap: user.spendingCap, used: user.spendingUsed });
      if (user.platform === "telegram") {
        sendCapExceededAlert(user.chatId, amountMusd, user.spendingCap, user.spendingUsed).catch(() => {});
      } else if (user.platform === "whatsapp") {
        sendWaCapExceeded(user.chatId, amountMusd, user.spendingCap, user.spendingUsed).catch(() => {});
      }
    }
  }

  // ── SAFE MODE PATH ──────────────────────────────────────────────────────────
  for (const user of safeUsers) {
    const approvalId = createPendingApproval(
      user.chatId, user.platform, userAddress, paymentId, amountMusd, recipient
    );

    if (user.platform === "telegram") {
      sendSafeApprovalRequest({
        chatId: user.chatId, approvalId, amountMusd, recipient, paymentId,
      }).catch(() => {});
    } else if (user.platform === "whatsapp") {
      sendWaSafeApprovalRequest(user.chatId, approvalId, amountMusd, recipient).catch(() => {});
    }

    logger.info("Safe mode: approval request sent", { userAddress, paymentId, chatId: user.chatId });
  }
}

async function runSchedulerCycle() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  lastRun = new Date();

  // Load mock users in demo mode
  if (registeredUsers.size === 0) {
    getAllMockUsers().forEach((u) => registeredUsers.add(u));
  }

  const allUsers = Array.from(registeredUsers);
  if (allUsers.length === 0) {
    schedulerRunning = false;
    return;
  }

  logger.debug(`Scheduler cycle`, { users: allUsers.length });

  for (const userAddress of allUsers) {
    try {
      const [payments, vaultInfo] = await Promise.all([
        getUserPayments(userAddress),
        getVaultInfo(userAddress),
      ]);

      totalChecked += payments.length;

      // Halt if collateral ratio is critical
      const collateralRatio = Number(vaultInfo.collateralRatio);
      if (collateralRatio > 0 && collateralRatio < 150) {
        logger.error("Collateral ratio critical — pausing payments", { userAddress, collateralRatio });
        continue;
      }

      // Get bot users for this address (to know their mode)
      const tgAutopilot = getAutopilotUsersForAddress(userAddress);
      const safeUsers = getAllSafeUsers().filter(
        (u) => u.mezoAddress?.toLowerCase() === userAddress.toLowerCase()
      );
      const botUsers = [...tgAutopilot, ...safeUsers];

      for (let i = 0; i < payments.length; i++) {
        const payment = payments[i];
        if (!payment.isActive) continue;

        const now = Math.floor(Date.now() / 1000);
        const lastExec = Number(payment.lastExecuted);
        const interval = Number(payment.interval);
        const isDue = lastExec === 0 || now >= lastExec + interval;
        if (!isDue) continue;

        if (vaultInfo.musdBalance < payment.amount) {
          logger.warn("Insufficient MUSD — skipping", { userAddress, paymentId: i });
          continue;
        }

        const amountMusd = Number(ethers.formatEther(payment.amount));
        const recipient = payment.isX402 ? payment.endpoint : payment.recipient;

        if (botUsers.length > 0) {
          // Route through bot safe/autopilot logic
          await processPayment(userAddress, i, amountMusd, recipient, botUsers, payment);
        } else {
          // No bot registered for this user — execute directly (legacy behavior)
          const result = await executePayment(userAddress, i, payment);
          if (result.success) {
            totalExecuted++;
            updateMockPaymentLastExecuted(userAddress, i, Math.floor(Date.now() / 1000));
          }
        }
      }
    } catch (err: any) {
      logger.error("Scheduler error for user", { userAddress, error: err.message });
    }
  }

  schedulerRunning = false;
}

export function startScheduler(intervalCron = "* * * * *") {
  logger.info("Starting payment scheduler", { cron: intervalCron });

  if (!process.env.VAULT_CONTRACT_ADDRESS) {
    const demoUser = process.env.DEMO_USER_ADDRESS;
    if (demoUser) {
      registerUser(demoUser);
      logger.info("Demo: seeded user", { address: demoUser });
    } else {
      logger.warn("Demo mode active but DEMO_USER_ADDRESS is not set — no users seeded. Register via POST /api/users/register");
    }
  }

  cron.schedule(intervalCron, async () => {
    try {
      await runSchedulerCycle();
    } catch (err: any) {
      logger.error("Unhandled scheduler error", { error: err.message });
      schedulerRunning = false;
    }
  });

  logger.info("Scheduler started ✅");
}

export async function triggerNow() {
  return runSchedulerCycle();
}
