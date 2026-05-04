import { NextRequest, NextResponse } from "next/server";
import { createConsensusRequest } from "@zk-whistleblower/db";

export const runtime = "nodejs";

// BigInt cannot be serialized by JSON.stringify — convert to string
function bigintSafe(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  try {
    const row = await createConsensusRequest(body);
    return NextResponse.json({ ok: true, data: bigintSafe(row) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
