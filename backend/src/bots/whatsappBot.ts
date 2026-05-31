/**
 * whatsappBot.ts — Bitstream Mezo WhatsApp Bot
 *
 * 2 user commands:
 *   stats              — Mezo wallet stats (BTC, MUSD, vault health)
 *   analyze <address>  — Wallet analysis + Bitstream app URL
 *
 * Settings (text-based):
 *   safe        — Switch to safe mode (AI asks before executing)
 *   autopilot   — Switch to autopilot mode (AI executes within cap)
 *   cap <N>     — Set monthly MUSD spending cap
 *   register <address> — Link Mezo wallet
 *   settings    — Show current settings
 *   help        — Command list
 */

import { Router, Request, Response } from "express";
import { ethers } from "ethers";
import { logger } from "../logger";
import { getMezoWalletStats } from "../services/mezoBalances";
import { scanWallet } from "../wallet/pipeline";
import { summarize } from "../wallet/ai/summary";
import { buildInsights } from "../wallet/engine/insights";
import { getTxs } from "../wallet/db";
import {
  getOrCreateUser,
  setUserAddress,
  setUserMode,
  setSpendingCap,
  consumePendingApproval,
  canAutopilotSpend,
  recordSpending,
  BotUser,
} from "../services/botUserDb";
import { executePayment } from "../agents/paymentExecutor";
import { getUserPayments } from "../services/vaultService";

const APP_URL = process.env.BITSTREAM_APP_URL ?? "https://bitstream.app";
const GRAPH_API = "https://graph.facebook.com/v20.0";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

function shortAddr(a: string): string {
  if (!a || a.length < 12) return a;
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function fmtBtc(n: number): string {
  return n < 0.001 ? `${(n * 1e8).toFixed(0)} sats` : `${n.toFixed(6)} BTC`;
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function detectChain(addr: string): "evm" | "btc" | null {
  if (/^0x[a-fA-F0-9]{40}$/.test(addr.trim())) return "evm";
  if (/^(1|3)[a-zA-HJ-NP-Z0-9]{25,34}$/.test(addr.trim()) || /^bc1[a-zA-HJ-NP-Z0-9]{6,87}$/.test(addr.trim())) return "btc";
  return null;
}

async function sendText(to: string, body: string): Promise<void> {
  if (!isConfigured()) return;
  const url = `${GRAPH_API}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { preview_url: false, body: body.slice(0, 4096) },
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      logger.warn("WhatsApp send failed", { status: res.status, body: errBody.slice(0, 200) });
    }
  } catch (err: any) {
    logger.error("WhatsApp send error", { error: err.message });
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

async function handleStats(to: string, user: BotUser): Promise<void> {
  if (!user.mezoAddress) {
    await sendText(to,
      "You haven't registered your Mezo wallet yet.\n\n" +
      "Send: register 0xYourMezoAddress"
    );
    return;
  }

  await sendText(to, "Fetching your Mezo wallet stats...");

  try {
    const stats = await getMezoWalletStats(user.mezoAddress);
    const healthLabel = stats.vaultHealth === "healthy" ? "HEALTHY" : stats.vaultHealth === "warning" ? "WARNING" : "DANGER";
    const capInfo = user.spendingCap > 0
      ? `\nSpending Cap: ${user.spendingUsed.toFixed(2)} / ${user.spendingCap} MUSD used this month`
      : "";

    const lines = [
      `Mezo Wallet - ${shortAddr(user.mezoAddress)}`,
      `${stats.network}`,
      ``,
      `BTC Balance`,
      `  ${fmtBtc(stats.btcBalance)} = ${fmtUsd(stats.btcUsd)}`,
      `  (BTC @ ${fmtUsd(stats.btcPrice)})`,
      ``,
      `MUSD Balance: ${stats.musdBalance.toFixed(2)} MUSD`,
      ``,
      `Vault`,
      `  Collateral: ${fmtBtc(stats.vaultCollateralBtc)} = ${fmtUsd(stats.vaultCollateralUsd)}`,
      `  Ratio: ${stats.collateralRatio > 0 ? `${stats.collateralRatio}%` : "No vault yet"} [${healthLabel}]`,
      ``,
      `Mode: ${user.mode === "autopilot" ? "Autopilot (auto-execute within cap)" : "Safe Mode (approve each payment)"}`,
      capInfo,
      ``,
      `Manage at: ${APP_URL}`,
    ];

    await sendText(to, lines.join("\n"));
  } catch (err: any) {
    logger.error("WhatsApp stats failed", { address: user.mezoAddress, error: err.message });
    await sendText(to, `Error fetching wallet stats: ${err.message}`);
  }
}

// ─── Analyze ─────────────────────────────────────────────────────────────────

async function handleAnalyze(to: string, address: string): Promise<void> {
  const chain = detectChain(address);
  if (!chain) {
    await sendText(to, "Unrecognized address. Send an EVM (0x...) or Bitcoin (bc1...) address.");
    return;
  }

  await sendText(to, `Analyzing ${shortAddr(address)}... this takes ~10 seconds.`);

  try {
    const { transactions, insights } = await scanWallet(address, chain);
    const summary = await summarize(insights);

    const topCats = Object.entries(insights.byCategory)
      .sort((a, b) => b[1].totalUsd - a[1].totalUsd)
      .slice(0, 3)
      .map(([cat, d]) => `  - ${cat}: ${d.count} txs${d.totalUsd > 0 ? ` (${fmtUsd(d.totalUsd)})` : ""}`)
      .join("\n");

    const recurring = insights.recurring.slice(0, 3)
      .map(r => `  - ${shortAddr(r.counterparty)}: ~${fmtUsd(r.typicalUsd)} / ${r.cadenceDays?.toFixed(0) ?? "?"} days (${r.category})`)
      .join("\n");

    const lines = [
      `Wallet Analysis - ${shortAddr(address)}`,
      ``,
      summary,
      ``,
      `${transactions.length} transactions analyzed over ${insights.windowDays} days`,
      ``,
      `Top categories:`,
      topCats || "  No significant activity",
      ...(recurring ? [``, `Recurring payments:`, recurring] : []),
      ...(insights.anomalies.length > 0 ? [``, `${insights.anomalies.length} unusual transaction(s) flagged`] : []),
      ``,
      `---`,
      `Automate your treasury on Mezo:`,
      `${APP_URL}`,
      ``,
      `Login & connect wallet:`,
      `${APP_URL}/connect`,
    ];

    await sendText(to, lines.join("\n"));
  } catch (err: any) {
    logger.error("WhatsApp analyze failed", { address, error: err.message });
    await sendText(to, `Analysis failed: ${err.message}`);
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function settingsText(user: BotUser): string {
  return [
    `Bitstream Settings`,
    ``,
    `Wallet: ${user.mezoAddress ? shortAddr(user.mezoAddress) : "not set"}`,
    `Mode: ${user.mode === "autopilot" ? "Autopilot" : "Safe Mode"}`,
    `Monthly Cap: ${user.spendingCap > 0 ? `${user.spendingCap} MUSD` : "not set"}`,
    `Used this month: ${user.spendingUsed.toFixed(2)} MUSD`,
    ``,
    `Commands:`,
    `  register <address> - link your Mezo wallet`,
    `  safe               - switch to safe mode`,
    `  autopilot          - switch to autopilot (requires cap)`,
    `  cap <amount>       - set MUSD/month spending cap`,
  ].join("\n");
}

// ─── Help ────────────────────────────────────────────────────────────────────

function helpText(): string {
  return [
    `Bitstream - Mezo Treasury Bot`,
    ``,
    `stats`,
    `  Your Mezo wallet: BTC balance, MUSD, vault health`,
    ``,
    `analyze <address>`,
    `  Analyze any EVM or Bitcoin wallet transactions`,
    ``,
    `register <address>`,
    `  Link your Mezo wallet address`,
    ``,
    `safe`,
    `  Safe Mode: AI asks before executing each payment`,
    ``,
    `autopilot`,
    `  Autopilot: AI auto-executes within your spending cap`,
    ``,
    `cap <amount>`,
    `  Set monthly MUSD spending cap for autopilot`,
    `  Example: cap 500`,
    ``,
    `settings`,
    `  Show current configuration`,
    ``,
    `help`,
    `  This message`,
  ].join("\n");
}

// ─── Pending approval tracking (WhatsApp — text-based confirm) ────────────────

// Map from (phone -> approvalId) for safe mode confirmations
const pendingWa = new Map<string, string>();

// ─── Message dispatcher ───────────────────────────────────────────────────────

async function dispatch(from: string, rawText: string): Promise<void> {
  const text = rawText.trim();
  if (!text) return;

  const user = getOrCreateUser(from, "whatsapp");
  const [cmd, ...rest] = text.split(/\s+/);
  const command = cmd.toLowerCase();
  const args = rest;

  // Check if waiting for approval confirmation
  const pendingId = pendingWa.get(from);
  if (pendingId) {
    const lower = text.toLowerCase();
    if (lower === "yes" || lower === "approve" || lower === "y") {
      pendingWa.delete(from);
      const approval = consumePendingApproval(pendingId);
      if (!approval) {
        await sendText(from, "Approval expired (5 min timeout). Payment was skipped.");
        return;
      }
      await sendText(from, `Executing payment of ${approval.amountMusd.toFixed(2)} MUSD...`);
      try {
        const payments = await getUserPayments(approval.userAddress);
        const payment = payments[approval.paymentId];
        if (!payment) throw new Error("Payment not found");
        const result = await executePayment(approval.userAddress, approval.paymentId, payment);
        if (result.success) {
          await sendText(from, `Payment executed! ${approval.amountMusd.toFixed(2)} MUSD -> ${shortAddr(approval.recipient)}\nTX: ${result.txHash ?? "mock"}`);
        } else {
          await sendText(from, `Payment failed: ${result.error ?? "unknown error"}`);
        }
      } catch (err: any) {
        await sendText(from, `Execution error: ${err.message}`);
      }
      return;
    }
    if (lower === "no" || lower === "skip" || lower === "n" || lower === "deny") {
      pendingWa.delete(from);
      consumePendingApproval(pendingId);
      await sendText(from, "Payment skipped.");
      return;
    }
  }

  if (command === "stats") {
    return handleStats(from, user);
  }

  if (command === "analyze" || command === "analyse") {
    const address = args[0]?.trim();
    if (!address) {
      if (user.mezoAddress) return handleAnalyze(from, user.mezoAddress);
      await sendText(from, "Usage: analyze <address>\nExample: analyze 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      return;
    }
    return handleAnalyze(from, address);
  }

  if (command === "register") {
    const address = args[0]?.trim();
    if (!address || !ethers.isAddress(address)) {
      await sendText(from, "Usage: register <evm-address>\nExample: register 0xYourMezoAddress");
      return;
    }
    setUserAddress(from, "whatsapp", address);
    await sendText(from, `Wallet registered: ${shortAddr(address)}\nSend "stats" to see your balances.`);
    return;
  }

  if (command === "safe") {
    setUserMode(from, "whatsapp", "safe");
    await sendText(from, "Safe Mode activated. I'll ask for your approval before executing any payment.\nReply yes/no when prompted.");
    return;
  }

  if (command === "autopilot") {
    if (!user.mezoAddress) {
      await sendText(from, "Register your wallet first: register 0xYourAddress");
      return;
    }
    if (user.spendingCap <= 0) {
      await sendText(from, "Set a spending cap first:\ncap 500\n\nThis limits how much MUSD the AI can execute per month.");
      return;
    }
    setUserMode(from, "whatsapp", "autopilot");
    await sendText(from,
      `Autopilot activated!\nCap: ${user.spendingCap} MUSD/month\n\nThe AI agent will auto-execute payments within this limit.\n\nTo authorize the agent on-chain, visit:\n${APP_URL}/settings/agent`
    );
    return;
  }

  if (command === "cap") {
    const amount = parseFloat(args[0] ?? "");
    if (isNaN(amount) || amount < 0) {
      await sendText(from, "Usage: cap <amount>\nExample: cap 500 (sets 500 MUSD/month limit)");
      return;
    }
    setSpendingCap(from, "whatsapp", amount);
    if (amount === 0) {
      setUserMode(from, "whatsapp", "safe");
      await sendText(from, "Spending cap removed. Switched to Safe Mode.");
    } else {
      await sendText(from,
        `Spending cap: ${amount} MUSD/month\n` +
        (user.mode !== "autopilot" ? `Send "autopilot" to enable auto-execution.` : `Autopilot is active.`)
      );
    }
    return;
  }

  if (command === "settings") {
    await sendText(from, settingsText(user));
    return;
  }

  if (command === "help" || command === "start" || command === "hi" || command === "hello") {
    await sendText(from, helpText());
    return;
  }

  // If input looks like an address, treat as analyze shortcut
  if (detectChain(text)) {
    return handleAnalyze(from, text);
  }

  await sendText(from, `Unknown command. Send "help" for the command list.`);
}

// ─── Push notifications from scheduler ───────────────────────────────────────

export async function sendWaSafeApprovalRequest(
  phone: string,
  approvalId: string,
  amountMusd: number,
  recipient: string
): Promise<void> {
  pendingWa.set(phone, approvalId);
  await sendText(phone,
    `Payment Due\n\n` +
    `Amount: ${amountMusd.toFixed(2)} MUSD\n` +
    `To: ${shortAddr(recipient)}\n\n` +
    `Reply "yes" to approve or "no" to skip.\n(Expires in 5 minutes)`
  );
}

export async function sendWaAutopilotNotification(
  phone: string,
  amountMusd: number,
  recipient: string,
  txHash: string,
  capUsed: number,
  capTotal: number
): Promise<void> {
  await sendText(phone,
    `Autopilot executed payment\n\n` +
    `${amountMusd.toFixed(2)} MUSD -> ${shortAddr(recipient)}\n` +
    `TX: ${txHash}\n` +
    `Monthly usage: ${capUsed.toFixed(2)} / ${capTotal} MUSD`
  );
}

export async function sendWaCapExceeded(
  phone: string,
  amountMusd: number,
  capTotal: number,
  capUsed: number
): Promise<void> {
  await sendText(phone,
    `Spending Cap Reached\n\n` +
    `A payment of ${amountMusd.toFixed(2)} MUSD would exceed your monthly cap.\n` +
    `Used: ${capUsed.toFixed(2)} / ${capTotal} MUSD\n\n` +
    `Increase with "cap <amount>" or approve manually.`
  );
}

// ─── Express Router ──────────────────────────────────────────────────────────

export const whatsappRouter = Router();

// Webhook verification
whatsappRouter.get("/webhook", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    logger.info("WhatsApp webhook verified");
    return res.status(200).send(String(challenge ?? ""));
  }
  return res.sendStatus(403);
});

// Incoming messages
whatsappRouter.post("/webhook", async (req: Request, res: Response) => {
  res.sendStatus(200); // Acknowledge immediately

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    if (!message || message.type !== "text") return;

    const from: string = message.from;
    const body: string = message.text?.body ?? "";
    logger.info("WhatsApp inbound", { from: shortAddr(from), preview: body.slice(0, 60) });

    if (!isConfigured()) {
      logger.warn("WhatsApp bot not configured — message dropped");
      return;
    }

    await dispatch(from, body);
  } catch (err: any) {
    logger.error("WhatsApp webhook error", { error: err.message });
  }
});

export function startWhatsappBot(): void {
  if (isConfigured()) {
    logger.info("WhatsApp bot configured (webhook: /api/whatsapp/webhook)");
  } else {
    logger.warn("WhatsApp env vars not set — webhook returns 200 but messages are not sent");
  }
}
