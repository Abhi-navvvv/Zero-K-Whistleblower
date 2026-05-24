import { NextRequest, NextResponse } from "next/server";
import { postAdminChatMessage, getAdminChatMessages } from "@zk-whistleblower/db";
import { prisma } from "@zk-whistleblower/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const requestId = searchParams.get("requestId");

  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId parameter" }, { status: 400 });
  }

  try {
    const messages = await getAdminChatMessages(requestId);
    return NextResponse.json({ ok: true, messages });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { consensusRequestId, senderAddress, senderPseudonym, ciphertext, iv, encryptedKeys } = body;
  if (!consensusRequestId || !senderAddress || !senderPseudonym || !ciphertext || !iv || !encryptedKeys) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  try {
    // Verify the consensus request exists and the sender is authorized
    const request = await (prisma as any).reportConsensusRequest.findUnique({
      where: { id: consensusRequestId },
      select: { selectedAdmins: true },
    });

    if (!request) {
      return NextResponse.json({ error: "Consensus request not found" }, { status: 404 });
    }

    const normalizedAdmins = request.selectedAdmins.map((a: string) => a.toLowerCase());
    if (!normalizedAdmins.includes(senderAddress.toLowerCase())) {
      return NextResponse.json({ error: "Sender is not authorized for this consensus committee" }, { status: 403 });
    }

    const row = await postAdminChatMessage(
      consensusRequestId,
      senderAddress,
      senderPseudonym,
      ciphertext,
      iv,
      encryptedKeys
    );

    return NextResponse.json({ ok: true, data: row });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
