import { NextRequest, NextResponse } from "next/server";
import { addAdminVote } from "@zk-whistleblower/db";
import { verifyMessage } from "ethers";
import { createPublicClient, http, type PublicClient } from "viem";
import { hardhat, sepolia } from "viem/chains";
import { REGISTRY_ABI, REGISTRY_ADDRESS } from "@zk-whistleblower/shared/src/contracts";
import { buildConsensusVoteMessage, normalizeConsensusAdmins } from "@zk-whistleblower/shared/src/consensus";
import { prisma } from "@zk-whistleblower/db";

export const runtime = "nodejs";

function bigintSafe(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

function readRpcUrl() {
  return process.env.RELAYER_RPC_URL || process.env.SEPOLIA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;
}

function readChain() {
  const chainName = process.env.NEXT_PUBLIC_NETWORK_NAME?.trim().toLowerCase();
  return chainName === "sepolia" ? sepolia : hardhat;
}

function createConsensusClient(): PublicClient {
  const rpcUrl = readRpcUrl();
  if (!rpcUrl) {
    throw new Error("Missing RPC URL for consensus validation");
  }
  return createPublicClient({ chain: readChain(), transport: http(rpcUrl) });
}


export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { consensusRequestId, adminAddress, vote, signature, reason, encryptedReason } = body;
  if (!consensusRequestId || !adminAddress || !vote) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (!signature) {
    return NextResponse.json({ error: "Missing vote signature" }, { status: 400 });
  }

  try {
    const request = await (prisma as any).reportConsensusRequest.findUnique({
      where: { id: consensusRequestId },
      select: { selectedAdmins: true, metadata: true, status: true },
    });
    if (!request) {
      return NextResponse.json({ error: "Consensus request not found" }, { status: 404 });
    }
    if (request.status !== "PENDING_REVIEW") {
      return NextResponse.json({ error: "Consensus request is no longer pending" }, { status: 409 });
    }

    const normalizedAdminAddress = normalizeConsensusAdmins([adminAddress])[0];
    const normalizedAdmins = normalizeConsensusAdmins(request.selectedAdmins ?? []);
    if (normalizedAdmins.length === 0) {
      return NextResponse.json({ error: "Consensus request has no selected admins" }, { status: 409 });
    }
    if (!normalizedAdmins.includes(normalizedAdminAddress)) {
      return NextResponse.json({ error: "Wallet is not part of the selected admin committee" }, { status: 403 });
    }

    const message = buildConsensusVoteMessage({
      consensusRequestId,
      vote,
      adminAddress: normalizedAdminAddress,
    });
    const recovered = verifyMessage(message, signature).toLowerCase();
    if (recovered !== normalizedAdminAddress) {
      return NextResponse.json({ error: "Invalid vote signature" }, { status: 401 });
    }

    const orgIdRaw = (request.metadata as { orgId?: string } | null)?.orgId;
    if (orgIdRaw !== undefined) {
      const publicClient = createConsensusClient();
      const orgId = BigInt(orgIdRaw);
      const isAdmin = await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: "isOrgAdmin",
        args: [orgId, normalizedAdminAddress as `0x${string}`],
      });
      if (!isAdmin) {
        return NextResponse.json({ error: "Wallet is not an on-chain admin for this org" }, { status: 403 });
      }
    }

    const row = await addAdminVote(consensusRequestId, adminAddress, vote, signature, reason, encryptedReason);
    return NextResponse.json({ ok: true, data: bigintSafe(row) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
