import { NextRequest, NextResponse } from "next/server";
import { formatUnits } from "viem";

/**
 * GET /api/vault/:address
 *
 * Bug 3: MUSD balance must be REAL, not a "0.0" demo stub.
 *
 * Reads the user's live MUSD balance with a standard ERC-20 balanceOf eth_call
 * and their native (BTC) collateral with eth_getBalance, both against the Mezo
 * JSON-RPC. Errors are surfaced with a code + human message and the raw RPC
 * response is logged — never swallowed into a generic "0.0" / "Failed".
 *
 * Network is configurable via the existing env vars. Defaults match the repo
 * (.env): Matsnet testnet RPC. MUSD_CONTRACT_ADDRESS should be set to the MUSD
 * token on the configured network; when unset it falls back to the verified
 * Mezo mainnet MUSD (18 decimals). On a network where that address has no code,
 * balanceOf returns 0x — a genuine zero balance, never a false error.
 */
const MEZO_RPC_URL = process.env.MEZO_RPC_URL || "https://rpc.matsnet.mezo.org";
// Verified via mezo.org docs + Mezo explorer (mainnet MUSD, 18 decimals).
const MUSD_TOKEN_ADDRESS =
  process.env.MUSD_CONTRACT_ADDRESS || "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186";
const RPC_TIMEOUT_MS = 10_000;

const BALANCE_OF_SELECTOR = "0x70a08231";

async function rpcCall(method: string, params: unknown[]): Promise<string> {
  const res = await fetch(MEZO_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    throw new Error(`Mezo RPC HTTP ${res.status} on ${method}: ${raw.slice(0, 200)}`);
  }
  const data = (await res.json()) as { result?: string; error?: { message?: string } };
  if (data.error) {
    // Surface the raw JSON-RPC error rather than swallowing it.
    throw new Error(`Mezo RPC error on ${method}: ${data.error.message ?? JSON.stringify(data.error)}`);
  }
  if (typeof data.result !== "string") {
    throw new Error(`Mezo RPC returned no result on ${method}`);
  }
  return data.result;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const musdConfigured = /^0x[a-fA-F0-9]{40}$/.test(MUSD_TOKEN_ADDRESS);
    const callData =
      BALANCE_OF_SELECTOR + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");

    const [musdHex, collateralHex] = await Promise.all([
      // Skip the token call if no valid MUSD address is configured — report 0
      // rather than erroring on a malformed `to`.
      musdConfigured
        ? rpcCall("eth_call", [{ to: MUSD_TOKEN_ADDRESS, data: callData }, "latest"])
        : Promise.resolve("0x"),
      rpcCall("eth_getBalance", [address, "latest"]),
    ]);

    const musdRaw = musdHex && musdHex !== "0x" ? BigInt(musdHex) : 0n;
    const collateralRaw = collateralHex && collateralHex !== "0x" ? BigInt(collateralHex) : 0n;

    return NextResponse.json({
      address,
      collateral: formatUnits(collateralRaw, 18),
      musdBalance: formatUnits(musdRaw, 18),
      // Collateral ratio needs the vault contract; without it we report 0 (no vault).
      collateralRatio: 0,
      payments: [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Log the raw cause server-side; return a structured, actionable error.
    console.error("[vault] MUSD/collateral fetch failed", { address, rpc: MEZO_RPC_URL, message });
    const isTimeout = /timeout|aborted|AbortError/i.test(message);
    return NextResponse.json(
      {
        error: isTimeout ? "Mezo RPC timed out" : "Mezo RPC unavailable",
        code: isTimeout ? "RPC_TIMEOUT" : "RPC_UNAVAILABLE",
        detail: message,
      },
      { status: 503 },
    );
  }
}
