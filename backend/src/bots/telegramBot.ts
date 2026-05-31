/**
 * telegramBot.ts — Bitstream Mezo Bot
 *
 * 2 user-facing commands:
 *   /stats             — Mezo wallet stats (BTC + worth, MUSD, vault health)
 *   /analyze <address> — Wallet transaction analysis + app URL
 *
 * Settings (via inline keyboard after /start or /settings):
 *   Safe mode     — AI flags payments; you approve each one
 *   Autopilot     — AI executes payments up to your monthly spending cap
 *   Spending cap  — MUSD/month limit for autopilot (requires text response)
 */

import { Telegraf, Context, Markup } from "telegraf";
import { Message } from "telegraf/types";
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
import { ethers } from "ethers";

const APP_URL = process.env.BITSTREAM_APP_URL ?? "https://bitstream.app";

let bot: Telegraf | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortAddr(a: string): string {
  if (!a || a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
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

function settingsKeyboard(user: BotUser) {
  const modeLabel = user.mode === "autopilot"
    ? "Mode: Autopilot ✅ | Switch to Safe 🛡"
    : "Mode: Safe 🛡 | Switch to Autopilot 🤖";

  const capLabel = user.spendingCap > 0
    ? `Spending Cap: ${user.spendingCap} MUSD/mo ✏️`
    : "Set Spending Cap 💰";

  const addressLabel = user.mezoAddress
    ? `Wallet: ${shortAddr(user.mezoAddress)} ✏️`
    : "Register Mezo Wallet 🔗";

  return Markup.inlineKeyboard([
    [Markup.button.callback(modeLabel, user.mode === "autopilot" ? "mode_safe" : "mode_autopilot")],
    [Markup.button.callback(capLabel, "set_cap")],
    [Markup.button.callback(addressLabel, "set_address")],
  ]);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

async function handleStats(ctx: Context, user: BotUser): Promise<void> {
  const address = user.mezoAddress;
  if (!address) {
    await ctx.reply(
      "You haven't registered your Mezo wallet yet.\n\n" +
      "Send your Mezo address to get started:\n`/register 0xYourMezoAddress`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const msg = await ctx.reply("Fetching your Mezo wallet stats…");

  try {
    const stats = await getMezoWalletStats(address);

    const healthEmoji = stats.vaultHealth === "healthy" ? "🟢" : stats.vaultHealth === "warning" ? "🟡" : "🔴";
    const capInfo = user.spendingCap > 0
      ? `\n💳 *Spending Cap:* ${user.spendingUsed.toFixed(2)} / ${user.spendingCap} MUSD used this month`
      : "";
    const modeInfo = user.mode === "autopilot"
      ? "🤖 *Autopilot* — payments auto-execute within cap"
      : "🛡 *Safe Mode* — you approve each payment";

    const lines = [
      `📊 *Mezo Wallet* \`${shortAddr(address)}\``,
      `_${stats.network}_`,
      ``,
      `₿ *BTC Balance*`,
      `  ${fmtBtc(stats.btcBalance)} · ${fmtUsd(stats.btcUsd)}`,
      `  _(BTC @ ${fmtUsd(stats.btcPrice)})_`,
      ``,
      `💵 *MUSD Balance:* ${stats.musdBalance.toFixed(2)} MUSD`,
      ``,
      `🏦 *Vault*`,
      `  Collateral: ${fmtBtc(stats.vaultCollateralBtc)} · ${fmtUsd(stats.vaultCollateralUsd)}`,
      `  Ratio: ${stats.collateralRatio > 0 ? `${stats.collateralRatio}%` : "No vault yet"} ${healthEmoji}`,
      ``,
      modeInfo,
      capInfo,
      ``,
      `[Manage on Bitstream ↗](${APP_URL})`,
    ];

    await ctx.telegram.editMessageText(
      ctx.chat!.id, (msg as Message.TextMessage).message_id, undefined,
      lines.join("\n"),
      {
        parse_mode: "Markdown",
        link_preview_options: { is_disabled: true },
        ...settingsKeyboard(user),
      }
    );
  } catch (err: any) {
    logger.error("Telegram /stats failed", { address, error: err.message });
    await ctx.reply(`❌ Could not fetch wallet stats: ${err.message}`);
  }
}

// ─── Analyze ─────────────────────────────────────────────────────────────────

async function handleAnalyze(ctx: Context, address: string): Promise<void> {
  const chain = detectChain(address);
  if (!chain) {
    await ctx.reply("❌ Unrecognized address. Send an EVM (0x…) or Bitcoin (bc1…) address.");
    return;
  }

  if (chain === "evm" && !ethers.isAddress(address)) {
    await ctx.reply("❌ Invalid EVM address checksum.");
    return;
  }

  const msg = await ctx.reply(`🔍 Analyzing \`${shortAddr(address)}\` — this takes ~10 seconds…`, { parse_mode: "Markdown" });

  try {
    const { transactions, insights } = await scanWallet(address, chain);
    const summary = await summarize(insights);

    const topCats = Object.entries(insights.byCategory)
      .sort((a, b) => b[1].totalUsd - a[1].totalUsd)
      .slice(0, 3)
      .map(([cat, d]) => `• ${cat}: ${d.count} txs${d.totalUsd > 0 ? ` · ${fmtUsd(d.totalUsd)}` : ""}`)
      .join("\n");

    const recurring = insights.recurring.slice(0, 3)
      .map(r => `• ${shortAddr(r.counterparty)} — ~${fmtUsd(r.typicalUsd)} every ${r.cadenceDays?.toFixed(0) ?? "?"}d (${r.category})`)
      .join("\n");

    const lines = [
      `📊 *Wallet Analysis* \`${shortAddr(address)}\``,
      ``,
      `_${summary}_`,
      ``,
      `📈 *${transactions.length} transactions · ${insights.windowDays} days*`,
      topCats || "• No significant activity",
      ``,
      ...(recurring ? [`🔁 *Recurring Payments:*`, recurring, ``] : []),
      ...(insights.anomalies.length > 0 ? [`⚠️ *${insights.anomalies.length} unusual transaction(s) flagged*`, ``] : []),
      `━━━━━━━━━━━━━━━━━━`,
      `💡 *Automate your treasury on Mezo*`,
      `Set up recurring MUSD payments, manage BTC collateral, and let the AI agent handle execution.`,
      ``,
      `[Open Bitstream ↗](${APP_URL}) · [Login & Connect Wallet](${APP_URL}/connect)`,
    ];

    await ctx.telegram.editMessageText(
      ctx.chat!.id, (msg as Message.TextMessage).message_id, undefined,
      lines.join("\n"),
      {
        parse_mode: "Markdown",
        link_preview_options: { is_disabled: true },
      }
    );
  } catch (err: any) {
    logger.error("Telegram /analyze failed", { address, error: err.message });
    await ctx.reply(`❌ Analysis failed: ${err.message}`);
  }
}

// ─── Payment Approval (safe mode) ────────────────────────────────────────────

async function handleApprovalCallback(ctx: Context, approvalId: string, approved: boolean): Promise<void> {
  await ctx.answerCbQuery();

  if (!approved) {
    const approval = consumePendingApproval(approvalId);
    await ctx.editMessageText(
      approval
        ? `❌ Payment to ${shortAddr(approval.recipient)} cancelled.`
        : "This approval has expired."
    );
    return;
  }

  const approval = consumePendingApproval(approvalId);
  if (!approval) {
    await ctx.editMessageText("⏰ This approval has expired (5 min timeout). The payment was skipped.");
    return;
  }

  await ctx.editMessageText(`⏳ Executing payment of ${approval.amountMusd.toFixed(2)} MUSD…`);

  try {
    const payments = await getUserPayments(approval.userAddress);
    const payment = payments[approval.paymentId];
    if (!payment) throw new Error("Payment not found in vault");

    const result = await executePayment(approval.userAddress, approval.paymentId, payment);

    if (result.success) {
      await ctx.editMessageText(
        `✅ Payment executed!\n` +
        `${approval.amountMusd.toFixed(2)} MUSD → ${shortAddr(approval.recipient)}\n` +
        `TX: \`${result.txHash ?? "mock"}\``,
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.editMessageText(`❌ Payment failed: ${result.error ?? "Unknown error"}`);
    }
  } catch (err: any) {
    logger.error("Telegram approval execution failed", { approvalId, error: err.message });
    await ctx.editMessageText(`❌ Execution error: ${err.message}`);
  }
}

// ─── Welcome / Start ─────────────────────────────────────────────────────────

function welcomeText(user: BotUser): string {
  const registered = user.mezoAddress
    ? `Your Mezo wallet: \`${shortAddr(user.mezoAddress)}\``
    : "No wallet registered yet — use /register to add yours.";

  return [
    `👋 *Welcome to Bitstream*`,
    `_Bitcoin-backed automated cashflow on Mezo_`,
    ``,
    `*2 commands:*`,
    `/stats — Your Mezo wallet balance & vault health`,
    `/analyze <address> — Analyze any EVM or BTC wallet`,
    ``,
    `*Current settings:*`,
    registered,
    `Mode: ${user.mode === "autopilot" ? "🤖 Autopilot" : "🛡 Safe Mode"}`,
    user.spendingCap > 0 ? `Spending Cap: ${user.spendingCap} MUSD/month` : "Spending Cap: not set",
    ``,
    `Use /settings to configure your wallet and mode.`,
  ].join("\n");
}

// ─── Conversation state (waiting for text input) ──────────────────────────────

const waitingFor = new Map<string, "address" | "cap">();

// ─── Bot Init ─────────────────────────────────────────────────────────────────

export function startTelegramBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — Telegram bot disabled");
    return;
  }

  bot = new Telegraf(token);

  // /start
  bot.start(async (ctx) => {
    const user = getOrCreateUser(String(ctx.from.id), "telegram");
    await ctx.reply(welcomeText(user), {
      parse_mode: "Markdown",
      ...settingsKeyboard(user),
    });
  });

  // /help
  bot.help(async (ctx) => {
    const user = getOrCreateUser(String(ctx.from.id), "telegram");
    await ctx.reply(welcomeText(user), {
      parse_mode: "Markdown",
      ...settingsKeyboard(user),
    });
  });

  // /settings
  bot.command("settings", async (ctx) => {
    const user = getOrCreateUser(String(ctx.from.id), "telegram");
    await ctx.reply(
      `⚙️ *Settings*\n\n` +
      `Wallet: ${user.mezoAddress ? `\`${shortAddr(user.mezoAddress)}\`` : "not set"}\n` +
      `Mode: ${user.mode === "autopilot" ? "🤖 Autopilot" : "🛡 Safe Mode"}\n` +
      `Monthly Cap: ${user.spendingCap > 0 ? `${user.spendingCap} MUSD` : "not set"}\n` +
      `Used this month: ${user.spendingUsed.toFixed(2)} MUSD`,
      { parse_mode: "Markdown", ...settingsKeyboard(user) }
    );
  });

  // /register <address>
  bot.command("register", async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    const address = args[0]?.trim();

    if (!address || !ethers.isAddress(address)) {
      await ctx.reply("Usage: `/register 0xYourMezoAddress`\n\nProvide your Mezo EVM wallet address.", { parse_mode: "Markdown" });
      return;
    }

    setUserAddress(String(ctx.from.id), "telegram", address);
    const user = getOrCreateUser(String(ctx.from.id), "telegram");
    await ctx.reply(
      `✅ Wallet registered: \`${shortAddr(address)}\`\n\nUse /stats to see your balances.`,
      { parse_mode: "Markdown", ...settingsKeyboard(user) }
    );
  });

  // /stats
  bot.command("stats", async (ctx) => {
    const user = getOrCreateUser(String(ctx.from.id), "telegram");
    await handleStats(ctx, user);
  });

  // /analyze <address>
  bot.command("analyze", async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    const address = args[0]?.trim();

    if (!address) {
      const user = getOrCreateUser(String(ctx.from.id), "telegram");
      // If they have a registered address, use it
      if (user.mezoAddress) {
        await handleAnalyze(ctx, user.mezoAddress);
      } else {
        await ctx.reply(
          "Usage: `/analyze <address>`\n\nOr register your wallet with /register and then use /analyze without arguments.",
          { parse_mode: "Markdown" }
        );
      }
      return;
    }

    await handleAnalyze(ctx, address);
  });

  // /safe — quick mode switch
  bot.command("safe", async (ctx) => {
    setUserMode(String(ctx.from.id), "telegram", "safe");
    await ctx.reply("🛡 *Safe Mode activated*\nI'll ask for your approval before executing any payment.", { parse_mode: "Markdown" });
  });

  // /autopilot — quick mode switch
  bot.command("autopilot", async (ctx) => {
    const user = getOrCreateUser(String(ctx.from.id), "telegram");
    if (!user.mezoAddress) {
      await ctx.reply("Register your wallet first with /register before enabling autopilot.");
      return;
    }
    if (user.spendingCap <= 0) {
      await ctx.reply(
        "🤖 *Autopilot requires a spending cap.*\n\nSet your monthly MUSD limit first:\n`/cap 500`\n\nThis limits how much MUSD the AI agent can execute per month without asking you.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    setUserMode(String(ctx.from.id), "telegram", "autopilot");
    await ctx.reply(
      `🤖 *Autopilot activated!*\n\n` +
      `Cap: ${user.spendingCap} MUSD/month\n` +
      `The AI agent will auto-execute your scheduled payments within this cap.\n\n` +
      `💡 *Note:* To let the executor wallet sign on-chain transactions on your behalf, make sure you've authorized it in your vault settings:\n` +
      `[Authorize Agent ↗](${APP_URL}/settings/agent)`,
      { parse_mode: "Markdown", link_preview_options: { is_disabled: true } }
    );
  });

  // /cap <amount>
  bot.command("cap", async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    const amount = parseFloat(args[0] ?? "");

    if (isNaN(amount) || amount <= 0) {
      await ctx.reply(
        "Usage: `/cap <amount>`\n\nExample: `/cap 500` — sets a 500 MUSD/month autopilot limit.\n\nSend `/cap 0` to disable autopilot.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    setSpendingCap(String(ctx.from.id), "telegram", amount);
    const user = getOrCreateUser(String(ctx.from.id), "telegram");

    if (amount === 0) {
      setUserMode(String(ctx.from.id), "telegram", "safe");
      await ctx.reply("✅ Spending cap removed. Switched to Safe Mode.");
      return;
    }

    await ctx.reply(
      `✅ Spending cap set: *${amount} MUSD/month*\n\n` +
      (user.mode !== "autopilot"
        ? `Use /autopilot to enable automatic execution within this cap.`
        : `Autopilot is active — payments will auto-execute up to this limit.`),
      { parse_mode: "Markdown" }
    );
  });

  // ─── Callback queries (inline button taps) ─────────────────────────────────

  bot.on("callback_query", async (ctx) => {
    const data = (ctx.callbackQuery as any).data as string;
    const chatId = String(ctx.from!.id);

    if (data === "mode_safe") {
      setUserMode(chatId, "telegram", "safe");
      await ctx.answerCbQuery("Safe mode activated 🛡");
      const user = getOrCreateUser(chatId, "telegram");
      await ctx.editMessageReplyMarkup(settingsKeyboard(user).reply_markup);
      await ctx.reply("🛡 *Safe Mode* — I'll ask for your approval before executing any payment.", { parse_mode: "Markdown" });
      return;
    }

    if (data === "mode_autopilot") {
      const user = getOrCreateUser(chatId, "telegram");
      if (!user.mezoAddress) {
        await ctx.answerCbQuery("Register your wallet first");
        await ctx.reply("Register your wallet first: /register 0xYourAddress");
        return;
      }
      if (user.spendingCap <= 0) {
        await ctx.answerCbQuery("Set a spending cap first");
        await ctx.reply(
          "Set your monthly MUSD spending cap first:\n`/cap 500`",
          { parse_mode: "Markdown" }
        );
        return;
      }
      setUserMode(chatId, "telegram", "autopilot");
      await ctx.answerCbQuery("Autopilot activated 🤖");
      const updated = getOrCreateUser(chatId, "telegram");
      await ctx.editMessageReplyMarkup(settingsKeyboard(updated).reply_markup);
      await ctx.reply(`🤖 *Autopilot active* — executing up to ${user.spendingCap} MUSD/month automatically.`, { parse_mode: "Markdown" });
      return;
    }

    if (data === "set_cap") {
      await ctx.answerCbQuery();
      waitingFor.set(chatId, "cap");
      await ctx.reply("Enter your monthly MUSD spending cap for autopilot:\n\n_Example: 500_\n\n/cancel to skip.", { parse_mode: "Markdown" });
      return;
    }

    if (data === "set_address") {
      await ctx.answerCbQuery();
      waitingFor.set(chatId, "address");
      await ctx.reply("Enter your Mezo wallet address (0x…):\n\n/cancel to skip.");
      return;
    }

    // Payment approval callbacks: approve_<id> or deny_<id>
    if (data.startsWith("approve_")) {
      await handleApprovalCallback(ctx, data.slice(8), true);
      return;
    }
    if (data.startsWith("deny_")) {
      await handleApprovalCallback(ctx, data.slice(5), false);
      return;
    }

    await ctx.answerCbQuery();
  });

  // ─── Handle text replies for conversational flows ─────────────────────────

  bot.on("text", async (ctx) => {
    const chatId = String(ctx.from.id);
    const text = ctx.message.text.trim();

    if (text === "/cancel") {
      waitingFor.delete(chatId);
      await ctx.reply("Cancelled.");
      return;
    }

    const waiting = waitingFor.get(chatId);

    if (waiting === "address") {
      if (!ethers.isAddress(text)) {
        await ctx.reply("❌ Invalid Mezo EVM address. Try again or /cancel.");
        return;
      }
      waitingFor.delete(chatId);
      setUserAddress(chatId, "telegram", text);
      await ctx.reply(`✅ Wallet registered: \`${shortAddr(text)}\`\nUse /stats to see your balances.`, { parse_mode: "Markdown" });
      return;
    }

    if (waiting === "cap") {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount < 0) {
        await ctx.reply("❌ Enter a number (e.g. 500). /cancel to skip.");
        return;
      }
      waitingFor.delete(chatId);
      setSpendingCap(chatId, "telegram", amount);
      await ctx.reply(
        `✅ Spending cap: *${amount} MUSD/month*\n` +
        (amount > 0 ? "Use /autopilot to enable auto-execution." : "Autopilot spending disabled."),
        { parse_mode: "Markdown" }
      );
      return;
    }

    // If it looks like an address, treat as /analyze shortcut
    if (detectChain(text)) {
      await handleAnalyze(ctx, text);
      return;
    }

    // Unknown message — show hint
    await ctx.reply(
      "Use /stats for your wallet or /analyze <address> for a transaction analysis.\n/help for full command list.",
      { parse_mode: "Markdown" }
    );
  });

  bot.catch((err: any) => {
    logger.error("Telegram bot error", { error: err.message });
  });

  bot.launch().then(() => {
    logger.info("Telegram bot started ✅");
  }).catch((err) => {
    logger.error("Telegram bot failed to start", { error: err.message });
  });

  process.once("SIGINT", () => bot?.stop("SIGINT"));
  process.once("SIGTERM", () => bot?.stop("SIGTERM"));
}

// ─── Push notifications from scheduler ───────────────────────────────────────

export interface PaymentNotification {
  chatId: string;
  approvalId: string;
  amountMusd: number;
  recipient: string;
  paymentId: number;
}

export async function sendSafeApprovalRequest(notification: PaymentNotification): Promise<void> {
  if (!bot) return;
  try {
    await bot.telegram.sendMessage(
      notification.chatId,
      `⚡ *Payment Due*\n\n` +
      `Amount: *${notification.amountMusd.toFixed(2)} MUSD*\n` +
      `To: \`${shortAddr(notification.recipient)}\`\n\n` +
      `Approve this payment?`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("✅ Approve", `approve_${notification.approvalId}`),
            Markup.button.callback("❌ Skip", `deny_${notification.approvalId}`),
          ],
        ]),
      }
    );
  } catch (err: any) {
    logger.error("Failed to send safe mode approval request", { error: err.message });
  }
}

export async function sendAutopilotNotification(
  chatId: string,
  amountMusd: number,
  recipient: string,
  txHash: string,
  capUsed: number,
  capTotal: number
): Promise<void> {
  if (!bot) return;
  try {
    await bot.telegram.sendMessage(
      chatId,
      `🤖 *Autopilot executed payment*\n\n` +
      `${amountMusd.toFixed(2)} MUSD → \`${shortAddr(recipient)}\`\n` +
      `TX: \`${txHash}\`\n` +
      `Monthly usage: ${capUsed.toFixed(2)} / ${capTotal} MUSD`,
      { parse_mode: "Markdown" }
    );
  } catch (err: any) {
    logger.error("Failed to send autopilot notification", { error: err.message });
  }
}

export async function sendCapExceededAlert(
  chatId: string,
  amountMusd: number,
  capTotal: number,
  capUsed: number
): Promise<void> {
  if (!bot) return;
  try {
    await bot.telegram.sendMessage(
      chatId,
      `⚠️ *Spending Cap Reached*\n\n` +
      `A payment of ${amountMusd.toFixed(2)} MUSD would exceed your monthly cap.\n` +
      `Used: ${capUsed.toFixed(2)} / ${capTotal} MUSD\n\n` +
      `Increase your cap with /cap or approve manually via /settings.`,
      { parse_mode: "Markdown" }
    );
  } catch (err: any) {
    logger.error("Failed to send cap exceeded alert", { error: err.message });
  }
}

export function getTelegramBot(): Telegraf | null {
  return bot;
}
