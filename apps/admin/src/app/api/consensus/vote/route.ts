import { NextRequest, NextResponse } from "next/server";
import { addAdminVote } from "@zk-whistleblower/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { consensusRequestId, adminAddress, vote, signature, reason, encryptedReason } = body;
  if (!consensusRequestId || !adminAddress || !vote) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  try {
    const row = await addAdminVote(consensusRequestId, adminAddress, vote, signature, reason, encryptedReason);
    return NextResponse.json({ ok: true, data: row });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
