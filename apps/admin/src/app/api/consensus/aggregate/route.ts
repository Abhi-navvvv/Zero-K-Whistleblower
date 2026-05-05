import { NextRequest, NextResponse } from "next/server";
import { computeConsensusResult, buildConsensusCommitment } from "@zk-whistleblower/db";

export const runtime = "nodejs";

function bigintSafe(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { consensusRequestId, chainId } = body;
  if (!consensusRequestId) return NextResponse.json({ error: "Missing consensusRequestId" }, { status: 400 });

  try {
    const { request, counts, assigned, decision } = await computeConsensusResult(consensusRequestId);

    // Always return tally info so the frontend can display live progress
    const tally = {
      counts,
      assigned,
      voted: (request.votes ?? []).length,
      majorityThreshold: assigned > 0 ? Math.floor((assigned * 2) / 3) + 1 : null,
    };

    if (!decision) {
      return NextResponse.json({
        ok: true,
        decided: false,
        tally,
        data: { request: bigintSafe(request) },
      });
    }

    // Majority reached — build on-chain commitment
    const reportId = request.onChainReportId ? Number(request.onChainReportId) : null;
    if (reportId === null) return NextResponse.json({ error: "No onChainReportId to anchor" }, { status: 400 });

    const timestamp = Math.floor(Date.now() / 1000);
    const chain = chainId ?? 1;
    const commitment = buildConsensusCommitment(reportId, decision, timestamp, chain);

    return NextResponse.json({
      ok: true,
      decided: true,
      tally,
      data: { commitment, reportId, decision, timestamp, chain },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
