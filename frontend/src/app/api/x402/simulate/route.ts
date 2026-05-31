import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { url, walletAddress, amount } = await req.json();

  if (!url || !walletAddress || !amount) {
    return NextResponse.json(
      { error: "url, walletAddress, and amount are required" },
      { status: 400 }
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad protocol");
  } catch {
    return NextResponse.json({ error: `Invalid URL: ${url}` }, { status: 400 });
  }

  // Probe the real endpoint
  let probeStatus = 0;
  let paymentRequirements: any = null;
  let probeError = "";

  try {
    const probe = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    probeStatus = probe.status;
    if (probe.status === 402) {
      try { paymentRequirements = await probe.json(); } catch {}
    }
  } catch (err: any) {
    probeError = err.message ?? "Network error";
  }

  if (probeError && probeStatus === 0) {
    return NextResponse.json({
      success: false,
      endpoint: url,
      timestamp: Date.now(),
      error: `Cannot reach endpoint: ${probeError}. Check that the URL is correct and publicly accessible.`,
      probe: { reachable: false, error: probeError },
    });
  }

  if (probeStatus !== 402 && probeStatus >= 200 && probeStatus < 300) {
    return NextResponse.json({
      success: true,
      endpoint: url,
      timestamp: Date.now(),
      statusCode: probeStatus,
      probe: { reachable: true, status: probeStatus, isX402: false },
      data: {
        message: `Endpoint returned ${probeStatus} without requiring payment. It may not be an x402-gated resource, or try a specific path (e.g. ${url}/api/resource).`,
      },
    });
  }

  // Real 402 → simulate payment
  const amountNum = parseFloat(amount);
  const success = Math.random() > 0.1;
  const txHash = success
    ? "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
    : undefined;

  return NextResponse.json({
    success,
    endpoint: url,
    txHash,
    timestamp: Date.now(),
    paidAmount: amountNum.toFixed(6),
    error: success ? undefined : "Payment simulation failed — insufficient MUSD balance",
    probe: {
      reachable: true,
      status: probeStatus,
      isX402: probeStatus === 402,
      paymentRequirements,
    },
  });
}
