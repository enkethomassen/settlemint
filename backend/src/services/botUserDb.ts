/**
 * botUserDb.ts
 * Persistent bot user settings: registered Mezo address, safe/autopilot mode,
 * spending cap, and monthly usage tracking.
 */

import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync } from "fs";

const DB_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
mkdirSync(DB_DIR, { recursive: true });

const db = new Database(join(DB_DIR, "bitstream.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS bot_users (
    chat_id          TEXT NOT NULL,
    platform         TEXT NOT NULL DEFAULT 'telegram',
    mezo_address     TEXT,
    mode             TEXT NOT NULL DEFAULT 'safe',
    spending_cap     REAL NOT NULL DEFAULT 0,
    spending_used    REAL NOT NULL DEFAULT 0,
    spending_reset   INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (chat_id, platform)
  );

  CREATE TABLE IF NOT EXISTS pending_approvals (
    id               TEXT PRIMARY KEY,
    chat_id          TEXT NOT NULL,
    platform         TEXT NOT NULL,
    user_address     TEXT NOT NULL,
    payment_id       INTEGER NOT NULL,
    amount_musd      REAL NOT NULL,
    recipient        TEXT NOT NULL,
    expires_at       INTEGER NOT NULL,
    created_at       INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_pending_chat ON pending_approvals(chat_id, platform);
`);

export type BotMode = "safe" | "autopilot";
export type BotPlatform = "telegram" | "whatsapp";

export interface BotUser {
  chatId: string;
  platform: BotPlatform;
  mezoAddress: string | null;
  mode: BotMode;
  spendingCap: number;    // MUSD per month, 0 = no autopilot
  spendingUsed: number;   // MUSD used this calendar month
  spendingReset: number;  // unix timestamp of next reset (1st of next month)
  createdAt: number;
  updatedAt: number;
}

export interface PendingApproval {
  id: string;
  chatId: string;
  platform: BotPlatform;
  userAddress: string;
  paymentId: number;
  amountMusd: number;
  recipient: string;
  expiresAt: number;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

const stmtUpsert = db.prepare(`
  INSERT INTO bot_users (chat_id, platform, mezo_address, mode, spending_cap, spending_used, spending_reset, updated_at)
  VALUES (@chatId, @platform, @mezoAddress, @mode, @spendingCap, @spendingUsed, @spendingReset, unixepoch())
  ON CONFLICT(chat_id, platform) DO UPDATE SET
    mezo_address   = COALESCE(excluded.mezo_address, mezo_address),
    mode           = excluded.mode,
    spending_cap   = excluded.spending_cap,
    spending_used  = excluded.spending_used,
    spending_reset = excluded.spending_reset,
    updated_at     = unixepoch()
`);

const stmtGet = db.prepare(`
  SELECT * FROM bot_users WHERE chat_id = ? AND platform = ?
`);

const stmtSetAddress = db.prepare(`
  INSERT INTO bot_users (chat_id, platform, mezo_address, updated_at)
  VALUES (@chatId, @platform, @mezoAddress, unixepoch())
  ON CONFLICT(chat_id, platform) DO UPDATE SET
    mezo_address = excluded.mezo_address,
    updated_at   = unixepoch()
`);

const stmtSetMode = db.prepare(`
  INSERT INTO bot_users (chat_id, platform, mode, updated_at)
  VALUES (@chatId, @platform, @mode, unixepoch())
  ON CONFLICT(chat_id, platform) DO UPDATE SET
    mode       = excluded.mode,
    updated_at = unixepoch()
`);

const stmtSetCap = db.prepare(`
  INSERT INTO bot_users (chat_id, platform, spending_cap, updated_at)
  VALUES (@chatId, @platform, @spendingCap, unixepoch())
  ON CONFLICT(chat_id, platform) DO UPDATE SET
    spending_cap = excluded.spending_cap,
    updated_at   = unixepoch()
`);

const stmtAddSpending = db.prepare(`
  UPDATE bot_users
  SET spending_used = spending_used + @amount, updated_at = unixepoch()
  WHERE chat_id = @chatId AND platform = @platform
`);

const stmtGetByAddress = db.prepare(`
  SELECT * FROM bot_users WHERE mezo_address = ? AND mode = 'autopilot'
`);

function rowToUser(r: any): BotUser {
  return {
    chatId: r.chat_id,
    platform: r.platform,
    mezoAddress: r.mezo_address ?? null,
    mode: r.mode as BotMode,
    spendingCap: r.spending_cap,
    spendingUsed: r.spending_used,
    spendingReset: r.spending_reset,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function nextMonthReset(): number {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return Math.floor(first.getTime() / 1000);
}

export function getOrCreateUser(chatId: string, platform: BotPlatform): BotUser {
  const existing = stmtGet.get(chatId, platform) as any;
  if (existing) {
    // Auto-reset monthly spending on new month
    const now = Math.floor(Date.now() / 1000);
    if (existing.spending_reset > 0 && now >= existing.spending_reset) {
      db.prepare(
        `UPDATE bot_users SET spending_used = 0, spending_reset = ?, updated_at = unixepoch()
         WHERE chat_id = ? AND platform = ?`
      ).run(nextMonthReset(), chatId, platform);
      existing.spending_used = 0;
      existing.spending_reset = nextMonthReset();
    }
    return rowToUser(existing);
  }

  stmtUpsert.run({
    chatId,
    platform,
    mezoAddress: null,
    mode: "safe",
    spendingCap: 0,
    spendingUsed: 0,
    spendingReset: nextMonthReset(),
  });
  return rowToUser(stmtGet.get(chatId, platform) as any);
}

export function setUserAddress(chatId: string, platform: BotPlatform, mezoAddress: string): void {
  stmtSetAddress.run({ chatId, platform, mezoAddress: mezoAddress.toLowerCase() });
}

export function setUserMode(chatId: string, platform: BotPlatform, mode: BotMode): void {
  stmtSetMode.run({ chatId, platform, mode });
}

export function setSpendingCap(chatId: string, platform: BotPlatform, musdPerMonth: number): void {
  stmtSetCap.run({ chatId, platform, spendingCap: musdPerMonth });
}

export function recordSpending(chatId: string, platform: BotPlatform, amountMusd: number): void {
  stmtAddSpending.run({ chatId, platform, amount: amountMusd });
}

export function canAutopilotSpend(user: BotUser, amountMusd: number): boolean {
  if (user.mode !== "autopilot") return false;
  if (user.spendingCap <= 0) return false;
  return user.spendingUsed + amountMusd <= user.spendingCap;
}

export function getAutopilotUsersForAddress(address: string): BotUser[] {
  const rows = stmtGetByAddress.all(address.toLowerCase()) as any[];
  return rows.map(rowToUser);
}

export function getAllSafeUsers(): BotUser[] {
  const rows = db.prepare(`SELECT * FROM bot_users WHERE mode = 'safe' AND mezo_address IS NOT NULL`).all() as any[];
  return rows.map(rowToUser);
}

// ─── Pending Approvals ────────────────────────────────────────────────────────

const stmtInsertApproval = db.prepare(`
  INSERT OR REPLACE INTO pending_approvals
    (id, chat_id, platform, user_address, payment_id, amount_musd, recipient, expires_at)
  VALUES (@id, @chatId, @platform, @userAddress, @paymentId, @amountMusd, @recipient, @expiresAt)
`);

const stmtGetApproval = db.prepare(`
  SELECT * FROM pending_approvals WHERE id = ? AND expires_at > unixepoch()
`);

const stmtDeleteApproval = db.prepare(`
  DELETE FROM pending_approvals WHERE id = ?
`);

export function createPendingApproval(
  chatId: string,
  platform: BotPlatform,
  userAddress: string,
  paymentId: number,
  amountMusd: number,
  recipient: string
): string {
  const id = `${chatId}_${paymentId}_${Date.now()}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 min TTL
  stmtInsertApproval.run({ id, chatId, platform, userAddress, paymentId, amountMusd, recipient, expiresAt });
  return id;
}

export function consumePendingApproval(id: string): PendingApproval | null {
  const row = stmtGetApproval.get(id) as any;
  if (!row) return null;
  stmtDeleteApproval.run(id);
  return {
    id: row.id,
    chatId: row.chat_id,
    platform: row.platform,
    userAddress: row.user_address,
    paymentId: row.payment_id,
    amountMusd: row.amount_musd,
    recipient: row.recipient,
    expiresAt: row.expires_at,
  };
}
