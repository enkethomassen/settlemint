import { NextRequest, NextResponse } from "next/server";
import { telegramStore } from "@/lib/telegram-store";
import {
  buildMezoActivity,
  type RawNativeTx,
  type RawTokenTransfer,
} from "@/lib/mezo-ledger";

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN ?? "";
const MEZO_API    = process.env.BLOCKSCOUT_BASE ?? "https://api.explorer.mezo.org";
const MEZO_TOKEN  = "0x7b7c000000000000000000000000000000000001";
const TG_API      = `https://api.telegram.org/bot${BOT_TOKEN}`;
const TIMEOUT_MS  = 12_000;

// ── Telegram send ─────────────────────────────────────────────────────────────
async function sendMessage(chatId: number, text: string, parse_mode = "HTML") {
  await fetch(`${TG_API}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode, disable_web_page_preview: true }),
  });
}

// ── Blockscout helpers ────────────────────────────────────────────────────────
async function fetchAddressData(address: string) {
  const res = await fetch(`${MEZO_API}/api/v2/addresses/${address}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return res.json() as Promise<any>;
}

async function fetchTokenBalances(address: string): Promise<Record<string, { balance: number; symbol: string }>> {
  const out: Record<string, { balance: number; symbol: string }> = {};
  try {
    let next: string | null = `${MEZO_API}/api/v2/addresses/${address}/tokens?type=ERC-20`;
    let pages = 0;
    while (next && pages < 5) {
      const res = await fetch(next, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) break;
      const data = (await res.json()) as { items?: any[]; next_page_params?: any };
      for (const item of data.items ?? []) {
        const sym    = (item.token?.symbol ?? "").toUpperCase();
        const dec    = Number(item.token?.decimals ?? "18") || 18;
        const raw    = item.value ?? "0";
        const amount = Number(raw) / 10 ** dec;
        out[sym] = { balance: amount, symbol: sym };
      }
      next = data.next_page_params
        ? `${MEZO_API}/api/v2/addresses/${address}/tokens?type=ERC-20&${new URLSearchParams(
            Object.entries(data.next_page_params).map(([k, v]) => [k, String(v)])
          )}`
        : null;
      pages++;
    }
  } catch { /* ignore */ }
  return out;
}

async function fetchBtcPrice(): Promise<number> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const d = await res.json() as any;
      return d?.bitcoin?.usd ?? 73743;
    }
  } catch { /* ignore */ }
  return 73743;
}

async function fetchMezoTokenPrice(): Promise<number> {
  try {
    const res = await fetch(
      `https://coins.llama.fi/prices/current/mezo:${MEZO_TOKEN}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const d = await res.json() as any;
      const p = d?.coins?.[`mezo:${MEZO_TOKEN}`]?.price;
      if (p && p > 0) return p;
    }
  } catch { /* ignore */ }
  return 0.0216;
}

async function fetchPaginated(path: string, cutoffSec: number): Promise<any[]> {
  const items: any[] = [];
  let params: Record<string, string | number> | null = null;
  let pages = 0;
  while (pages < 10) {
    const qs = params
      ? "?" + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
      : "";
    const res = await fetch(`${MEZO_API}${path}${qs}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) break;
    const data = (await res.json()) as { items?: any[]; next_page_params?: Record<string, any> | null };
    const page = Array.isArray(data.items) ? data.items : [];
    items.push(...page);
    pages++;
    const oldest = page[page.length - 1];
    const oldestTs = oldest?.timestamp ? new Date(oldest.timestamp).getTime() / 1000 : null;
    if (oldestTs != null && oldestTs < cutoffSec) break;
    if (!data.next_page_params || page.length === 0) break;
    params = data.next_page_params as Record<string, string | number>;
  }
  return items;
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtBTC(n: number) {
  return n.toFixed(6).replace(/\.?0+$/, "");
}
function fmtUSD(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}
function fmtNum(n: number, dec = 4) {
  return n.toFixed(dec).replace(/\.?0+$/, "") || "0";
}
function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function handleVault(chatId: number, address: string) {
  await sendMessage(chatId, "⏳ Fetching your Mezo balances…");

  const [addrData, tokens, btcPrice, mezoPrice] = await Promise.all([
    fetchAddressData(address),
    fetchTokenBalances(address),
    fetchBtcPrice(),
    fetchMezoTokenPrice(),
  ]);

  const coinWei  = parseFloat(addrData?.coin_balance ?? "0");
  const btcBal   = coinWei / 1e18;
  const btcUSD   = btcBal * btcPrice;

  const mezo  = tokens["MEZO"]  ?? { balance: 0, symbol: "MEZO" };
  const musd  = tokens["MUSD"]  ?? { balance: 0, symbol: "MUSD" };
  const mezoUSD = mezo.balance * mezoPrice;
  const totalUSD = btcUSD + mezoUSD + musd.balance;

  const lines = [
    `🟠 <b>Mezo Vault</b> — <code>${shortAddr(address)}</code>`,
    `<a href="https://explorer.mezo.org/address/${address}">View on explorer</a>`,
    "",
    `₿  <b>BTC</b>:  <code>${fmtBTC(btcBal)} BTC</code>  <i>(${fmtUSD(btcUSD)})</i>`,
    `🪙  <b>MEZO</b>: <code>${fmtNum(mezo.balance, 2)} MEZO</code>  <i>(${fmtUSD(mezoUSD)})</i>`,
    `💵  <b>MUSD</b>: <code>${fmtNum(musd.balance, 2)} MUSD</code>  <i>(${fmtUSD(musd.balance)})</i>`,
    "",
    `📊  <b>Total:</b> ${fmtUSD(totalUSD)}`,
    `💹  BTC @ ${fmtUSD(btcPrice)}  ·  MEZO @ $${mezoPrice.toFixed(4)}`,
  ];

  await sendMessage(chatId, lines.join("\n"));
}

async function handleAnalyze(chatId: number, address: string) {
  await sendMessage(chatId, "⏳ Running 60-day treasury analysis…");

  const rangeDays = 60;
  const cutoffSec = Math.floor(Date.now() / 1000) - rangeDays * 86400;

  const [nativeArr, tokenArr, btcPrice, mezoPrice] = await Promise.all([
    fetchPaginated(`/api/v2/addresses/${address}/transactions`, cutoffSec),
    fetchPaginated(`/api/v2/addresses/${address}/token-transfers`, cutoffSec),
    fetchBtcPrice(),
    fetchMezoTokenPrice(),
  ]);

  const activity = buildMezoActivity({
    address,
    range:      "60d",
    rangeDays,
    nativeTxs:  nativeArr as RawNativeTx[],
    tokenTransfers: tokenArr as RawTokenTransfer[],
    btcPrice,
    mezoPrice,
    minValueUSD: 0.5,
  });

  const burn    = activity.monthlyBurn;
  const burnStr = burn > 0 ? fmtUSD(burn) + "/mo" : "—";
  const topCats = activity.spendByCategory.slice(0, 3);
  const topRec  = activity.recurringPatterns.slice(0, 3);

  const lines: string[] = [
    `📊 <b>Treasury Analysis</b> — 60 days`,
    `<code>${shortAddr(address)}</code>`,
    "",
    `🔥 <b>Monthly Burn:</b>  ${burnStr}`,
    `🛣️  <b>Runway:</b>       ${activity.totals.knownUsdOutgoing > 0 ? activity.monthlyBurn > 0 ? "calculating…" : "∞" : "∞"}`,
    `↔️  <b>Transactions:</b> ${activity.ledgerEventCount} events`,
    `🔁  <b>Recurring:</b>    ${activity.recurringPatterns.length} pattern${activity.recurringPatterns.length !== 1 ? "s" : ""} detected`,
    "",
  ];

  if (topCats.length > 0) {
    lines.push("📂 <b>Spend by Category</b>");
    for (const c of topCats) {
      lines.push(`  • ${c.category}: ${fmtUSD(c.amountUSD)} (${c.percentage}%)`);
    }
    lines.push("");
  }

  if (topRec.length > 0) {
    lines.push("🔁 <b>Recurring Patterns</b>");
    for (const r of topRec) {
      const amt = r.usdAvailable && r.amountUSD > 0 ? fmtUSD(r.amountUSD) : `${fmtNum(r.amount)} ${r.token}`;
      lines.push(`  • <code>${shortAddr(r.toAddress)}</code>  ${r.frequency}  ·  ${r.occurrences}× · ${amt}`);
    }
    lines.push("");
  }

  const unknownSyms = Object.keys(activity.totals.unknownPriceTokenOutgoing);
  if (unknownSyms.length > 0) {
    lines.push(`⚠️ <i>Price unavailable for: ${unknownSyms.join(", ")}</i>`);
  }

  lines.push(`🔗 <a href="https://explorer.mezo.org/address/${address}">Open in explorer</a>`);

  await sendMessage(chatId, lines.join("\n"));
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Optional secret-token verification
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const incoming = req.headers.get("x-telegram-bot-api-secret-token");
    if (incoming !== secret) return NextResponse.json({ ok: false }, { status: 401 });
  }

  if (!BOT_TOKEN) return NextResponse.json({ ok: false, error: "TELEGRAM_BOT_TOKEN not set" }, { status: 500 });

  const update = (await req.json().catch(() => null)) as any;
  if (!update) return NextResponse.json({ ok: true });

  const msg    = update?.message ?? update?.edited_message;
  if (!msg?.text) return NextResponse.json({ ok: true });

  const chatId: number = msg.chat.id;
  const text: string   = (msg.text ?? "").trim();

  // Parse command + argument
  const [rawCmd, ...argParts] = text.split(/\s+/);
  const cmd  = rawCmd.replace(/@\S+/, "").toLowerCase(); // strip @BotName suffix
  const arg  = argParts.join("").trim();

  // Resolve address: from argument, or stored mapping, or nothing
  const stored  = telegramStore.get(chatId);
  const address = arg.match(/^0x[a-fA-F0-9]{40}$/) ? arg : (stored ?? "");

  try {
    switch (cmd) {
      case "/start":
      case "/help":
        await sendMessage(chatId, [
          "🟠 <b>MezoStats Bot</b>",
          "",
          "Track your Mezo wallet from Telegram.",
          "",
          "<b>Commands:</b>",
          "/register <code>0x…</code>  — link your wallet once",
          "/vault                — BTC, MEZO &amp; MUSD balances",
          "/analyze              — 60-day treasury analysis",
          "",
          "<i>Or pass address inline:</i>",
          "/vault <code>0x1b41…</code>",
          "/analyze <code>0x1b41…</code>",
        ].join("\n"));
        break;

      case "/register": {
        const toStore = arg.match(/^0x[a-fA-F0-9]{40}$/) ? arg : "";
        if (!toStore) {
          await sendMessage(chatId, "❌ Invalid address. Usage: /register <code>0x…</code>");
          break;
        }
        telegramStore.set(chatId, toStore);
        await sendMessage(chatId, `✅ Wallet <code>${shortAddr(toStore)}</code> linked. Use /vault or /analyze anytime.`);
        break;
      }

      case "/vault":
        if (!address) {
          await sendMessage(chatId, "❌ No wallet linked. Send:\n/register <code>0x…</code>\nor: /vault <code>0x…</code>");
          break;
        }
        await handleVault(chatId, address);
        break;

      case "/analyze":
        if (!address) {
          await sendMessage(chatId, "❌ No wallet linked. Send:\n/register <code>0x…</code>\nor: /analyze <code>0x…</code>");
          break;
        }
        await handleAnalyze(chatId, address);
        break;

      default:
        // Silently ignore unknown commands
        break;
    }
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    await sendMessage(chatId, `⚠️ Something went wrong: <code>${detail.slice(0, 200)}</code>`);
  }

  return NextResponse.json({ ok: true });
}
