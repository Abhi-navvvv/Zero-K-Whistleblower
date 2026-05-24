import { NextRequest, NextResponse } from "next/server";
import { registerAdminChatKey, getAdminChatKeys } from "@zk-whistleblower/db";
import { verifyMessage } from "ethers";
import { normalizeConsensusAdmins } from "@zk-whistleblower/shared/src/consensus";
import { prisma } from "@zk-whistleblower/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const requestId = searchParams.get("requestId");

  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId parameter" }, { status: 400 });
  }

  try {
    const request = await (prisma as any).reportConsensusRequest.findUnique({
      where: { id: requestId },
      select: { selectedAdmins: true },
    });

    if (!request) {
      return NextResponse.json({ error: "Consensus request not found" }, { status: 404 });
    }

    const keys = await getAdminChatKeys(request.selectedAdmins);
    return NextResponse.json({ ok: true, keys });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { adminAddress, publicKeyJwk, signature } = body;
  if (!adminAddress || !publicKeyJwk || !signature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  try {
    const normalizedAdminAddress = normalizeConsensusAdmins([adminAddress])[0];
    const message = `Registering chat key: ${publicKeyJwk}`;
    const recovered = verifyMessage(message, signature).toLowerCase();

    if (recovered !== normalizedAdminAddress) {
      return NextResponse.json({ error: "Invalid registration signature" }, { status: 401 });
    }

    await registerAdminChatKey(normalizedAdminAddress, publicKeyJwk, signature);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
