"use client";
/**
 * useVault — reads live vault state from MUSDVault contract via wagmi.
 * When VAULT_ADDRESS is not configured (demo mode), falls back to backend API.
 */
import { useAccount, useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { VAULT_ABI, VAULT_ADDRESS } from "@/lib/contract";
import { api } from "@/lib/api";
import { useMemo, useEffect, useState, useCallback } from "react";

export interface VaultOnChain {
  collateralRaw: bigint;
  musdBalanceRaw: bigint;
  collateralRatio: bigint;
  paymentCount: bigint;
  collateral: string;   // formatted BTC
  musdBalance: string;  // formatted MUSD
  payments: OnChainPayment[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  refetch: () => void;
}

export interface OnChainPayment {
  id: number;
  recipient: string;
  amount: string;       // formatted MUSD
  amountRaw: bigint;
  interval: number;
  lastExecuted: number;
  isActive: boolean;
  isX402: boolean;
  endpoint: string;
  nextExecution: string;
}

// ── Demo mode (no contract address) — fetch from backend API ─────────────────

function useDemoVault(address: string | undefined): VaultOnChain {
  const [data, setData] = useState<VaultOnChain | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    if (!address) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const vault = await api.getVault(address);
      const payments: OnChainPayment[] = vault.payments.map((p) => {
        const nextTs = p.lastExecuted === 0 ? Date.now() / 1000 : p.lastExecuted + p.interval;
        const nextDate = new Date(nextTs * 1000);
        const isPast = nextDate <= new Date();
        const nextExecution = isPast
          ? "Due now"
          : nextDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

        return {
          id: p.id,
          recipient: p.recipient,
          amount: p.amount,
          amountRaw: BigInt(0),
          interval: p.interval,
          lastExecuted: p.lastExecuted,
          isActive: p.isActive,
          isX402: p.isX402,
          endpoint: p.endpoint,
          nextExecution,
        };
      });

      const collateralBig = BigInt(Math.round(parseFloat(vault.collateral) * 1e9)) * BigInt(1e9);
      const musdBig       = BigInt(Math.round(parseFloat(vault.musdBalance) * 1e9)) * BigInt(1e9);

      setData({
        collateralRaw: collateralBig,
        musdBalanceRaw: musdBig,
        collateralRatio: BigInt(vault.collateralRatio),
        paymentCount: BigInt(payments.length),
        collateral: vault.collateral,
        musdBalance: vault.musdBalance,
        payments,
        isLoading: false,
        isError: false,
        refetch: load,
      });
      setIsError(false);
      setErrorMessage(undefined);
    } catch (e: unknown) {
      setIsError(true);
      // api.getVault throws Error(message) — message carries the structured
      // reason from the route (e.g. "Mezo RPC unavailable").
      setErrorMessage(e instanceof Error ? e.message : "Could not reach Mezo RPC");
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return {
      collateralRaw: 0n,
      musdBalanceRaw: 0n,
      collateralRatio: 0n,
      paymentCount: 0n,
      collateral: "0",
      musdBalance: "0",
      payments: [],
      isLoading,
      isError,
      errorMessage,
      refetch: load,
    };
  }

  return { ...data, isLoading, isError, errorMessage, refetch: load };
}

// ── Live mode (contract address configured) — read from chain ─────────────────

function useLiveVault(address: string | undefined): VaultOnChain {
  const vaultInfoResult = useReadContract({
    address: VAULT_ADDRESS || undefined,
    abi: VAULT_ABI,
    functionName: "getVaultInfo",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address && !!VAULT_ADDRESS },
  });

  const paymentsResult = useReadContract({
    address: VAULT_ADDRESS || undefined,
    abi: VAULT_ABI,
    functionName: "getUserPayments",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address && !!VAULT_ADDRESS },
  });

  const isLoading = vaultInfoResult.isLoading || paymentsResult.isLoading;
  const isError   = vaultInfoResult.isError   || paymentsResult.isError;

  const [collateralRaw, musdBalanceRaw, collateralRatio, paymentCount] =
    (vaultInfoResult.data as [bigint, bigint, bigint, bigint] | undefined) ??
    [0n, 0n, 0n, 0n];

  const rawPayments = (paymentsResult.data as any[] | undefined) ?? [];

  const payments: OnChainPayment[] = useMemo(() => {
    return rawPayments.map((p, i) => {
      const lastExec = Number(p.lastExecuted);
      const interval = Number(p.interval);
      const nextTs   = lastExec === 0 ? Date.now() / 1000 : lastExec + interval;
      const nextDate = new Date(nextTs * 1000);
      const isPast   = nextDate <= new Date();
      const nextExecution = isPast
        ? "Due now"
        : nextDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

      return {
        id: i,
        recipient: p.recipient as string,
        amount: formatUnits(p.amount as bigint, 18),
        amountRaw: p.amount as bigint,
        interval,
        lastExecuted: lastExec,
        isActive: p.isActive as boolean,
        isX402: p.isX402 as boolean,
        endpoint: p.endpoint as string,
        nextExecution,
      };
    });
  }, [rawPayments]);

  const refetch = useCallback(() => {
    vaultInfoResult.refetch();
    paymentsResult.refetch();
  }, [vaultInfoResult, paymentsResult]);

  return {
    collateralRaw,
    musdBalanceRaw,
    collateralRatio,
    paymentCount,
    collateral: formatUnits(collateralRaw, 18),
    musdBalance: formatUnits(musdBalanceRaw, 18),
    payments,
    isLoading,
    isError,
    errorMessage: isError ? "Could not read the vault contract on Mezo" : undefined,
    refetch,
  };
}

// ── Public hook — auto-selects mode ──────────────────────────────────────────

export function useVault(): VaultOnChain {
  const { address } = useAccount();
  const liveMode = !!VAULT_ADDRESS;

  const live = useLiveVault(liveMode ? address : undefined);
  const demo = useDemoVault(!liveMode ? address : undefined);

  return liveMode ? live : demo;
}
