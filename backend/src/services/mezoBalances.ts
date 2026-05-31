/**
 * mezoBalances.ts
 * Fetch wallet stats from Mezo network: native BTC balance, MUSD balance,
 * vault collateral, and USD prices.
 */

import { ethers, JsonRpcProvider, Contract } from "ethers";
import { getVaultInfo } from "./vaultService";

const MEZO_RPC = process.env.MEZO_RPC_URL ?? "https://rpc.matsnet.mezo.org";
const MUSD_ADDRESS = process.env.MUSD_CONTRACT_ADDRESS ?? "";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

let provider: JsonRpcProvider | null = null;

function getProvider(): JsonRpcProvider {
  if (!provider) provider = new JsonRpcProvider(MEZO_RPC);
  return provider;
}

// Price cache — 60 second TTL
let priceCache: { btcUsd: number; at: number } = { btcUsd: 65000, at: 0 };

async function getBtcPrice(): Promise<number> {
  if (Date.now() - priceCache.at < 60_000) return priceCache.btcUsd;
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const data = (await res.json()) as any;
      const price = data?.bitcoin?.usd;
      if (price) {
        priceCache = { btcUsd: price, at: Date.now() };
        return price;
      }
    }
  } catch {
    // Use cached fallback
  }
  return priceCache.btcUsd;
}

export interface MezoWalletStats {
  address: string;
  // Native BTC/mBTC on Mezo
  btcBalance: number;
  btcUsd: number;
  btcPrice: number;
  // mUSD stablecoin
  musdBalance: number;
  // Vault (from contract or mock)
  vaultCollateralBtc: number;
  vaultCollateralUsd: number;
  vaultMusd: number;
  collateralRatio: number;
  vaultHealth: "healthy" | "warning" | "danger";
  // Mode labels
  network: string;
  isTestnet: boolean;
}

export async function getMezoWalletStats(address: string): Promise<MezoWalletStats> {
  const p = getProvider();
  const btcPrice = await getBtcPrice();
  const isTestnet = MEZO_RPC.includes("matsnet") || MEZO_RPC.includes("testnet");

  // Fetch native balance (BTC on Mezo) and MUSD in parallel
  const [rawBalance, vaultInfo] = await Promise.all([
    p.getBalance(address).catch(() => 0n),
    getVaultInfo(address).catch(() => ({
      collateral: 0n,
      musdBalance: 0n,
      collateralRatio: 0n,
      paymentCount: 0n,
    })),
  ]);

  const btcBalance = Number(ethers.formatEther(rawBalance));

  // MUSD ERC-20 balance (separate from vault MUSD)
  let musdBalance = 0;
  if (MUSD_ADDRESS && ethers.isAddress(MUSD_ADDRESS)) {
    try {
      const musdContract = new Contract(MUSD_ADDRESS, ERC20_ABI, p);
      const raw = await musdContract.balanceOf(address);
      musdBalance = Number(ethers.formatEther(raw));
    } catch {
      // Contract not deployed yet — use vault MUSD
    }
  }

  const vaultCollateralBtc = Number(ethers.formatEther(vaultInfo.collateral));
  const vaultMusd = Number(ethers.formatEther(vaultInfo.musdBalance));
  const collateralRatio = Number(vaultInfo.collateralRatio);

  // Use vault MUSD if no separate wallet MUSD
  if (musdBalance === 0 && vaultMusd > 0) musdBalance = vaultMusd;

  const vaultCollateralUsd = vaultCollateralBtc * btcPrice;
  const vaultHealth: MezoWalletStats["vaultHealth"] =
    collateralRatio === 0 ? "healthy"  // no vault yet
    : collateralRatio < 150 ? "danger"
    : collateralRatio < 175 ? "warning"
    : "healthy";

  return {
    address,
    btcBalance,
    btcUsd: btcBalance * btcPrice,
    btcPrice,
    musdBalance,
    vaultCollateralBtc,
    vaultCollateralUsd,
    vaultMusd,
    collateralRatio,
    vaultHealth,
    network: isTestnet ? "Mezo Testnet (matsnet)" : "Mezo Mainnet",
    isTestnet,
  };
}
