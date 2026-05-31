import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { vault, history } = await req.json();

  if (!vault?.address) {
    return NextResponse.json({ error: "vault snapshot required" }, { status: 400 });
  }

  // Simple deterministic forecast — no OpenAI needed
  const payments: any[] = vault.payments ?? [];
  const now = Math.floor(Date.now() / 1000);
  const days: { date: string; outflow: number }[] = [];

  for (let d = 0; d < 30; d++) {
    const dayStart = now + d * 86400;
    const dayEnd = dayStart + 86400;
    let outflow = 0;
    for (const p of payments) {
      if (!p.isActive) continue;
      const interval = Number(p.interval);
      if (interval <= 0) continue;
      const lastEx = Number(p.lastExecuted || 0);
      const nextEx = lastEx === 0 ? dayStart : lastEx + interval;
      if (nextEx >= dayStart && nextEx < dayEnd) {
        outflow += parseFloat(p.amount || "0");
      }
    }
    days.push({
      date: new Date(dayStart * 1000).toISOString().slice(0, 10),
      outflow,
    });
  }

  const total30d = days.reduce((s, d) => s + d.outflow, 0);
  const avgDaily = total30d / 30;
  const balance = parseFloat(vault.musdBalance ?? "0");
  const runwayDays = avgDaily > 0 ? Math.floor(balance / avgDaily) : null;

  return NextResponse.json({
    days,
    total30d,
    avgDaily,
    runwayDays,
    balance,
    summary:
      runwayDays === null
        ? "No scheduled outflows in the next 30 days."
        : runwayDays < 7
        ? `⚠️ Critical: runway only ${runwayDays} days at current burn rate.`
        : `Runway: ~${runwayDays} days at current burn rate.`,
  });
}
