import { NextRequest, NextResponse } from "next/server";
import { upsertConsensusRequest, findActiveConsensusForReport } from "@zk-whistleblower/db";

export const runtime = "nodejs";

// BigInt cannot be serialized by JSON.stringify — convert to string
function bigintSafe(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

/** POST — create or return existing active consensus for a report */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  try {
    const { row, created } = await upsertConsensusRequest(body);
    return NextResponse.json({ ok: true, created, data: bigintSafe(row) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

/** GET ?reportId=11 — look up active consensus for a report without creating one */
export async function GET(req: NextRequest) {
  const reportId = req.nextUrl.searchParams.get("reportId");
  if (!reportId || isNaN(Number(reportId))) {
    return NextResponse.json({ error: "Missing or invalid reportId" }, { status: 400 });
  }

  try {
    const row = await findActiveConsensusForReport(Number(reportId));
    if (!row) return NextResponse.json({ ok: true, found: false, data: null });
    return NextResponse.json({ ok: true, found: true, data: bigintSafe(row) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
