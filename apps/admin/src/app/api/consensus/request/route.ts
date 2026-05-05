import { NextRequest, NextResponse } from "next/server";
import { upsertConsensusRequest, findActiveConsensusForReport } from "@zk-whistleblower/db";
import { createPublicClient, http, type PublicClient } from "viem";
import { hardhat, sepolia } from "viem/chains";
import { REGISTRY_ABI, REGISTRY_ADDRESS } from "@zk-whistleblower/shared/src/contracts";
import { buildConsensusRequestMessage, normalizeConsensusAdmins } from "@zk-whistleblower/shared/src/consensus";
import { verifyMessage } from "ethers";

export const runtime = "nodejs";

// BigInt cannot be serialized by JSON.stringify — convert to string
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

async function assertOrgAdmin(publicClient: PublicClient, orgId: bigint, account: `0x${string}`) {
  const isAdmin = await publicClient.readContract({
    address: REGISTRY_ADDRESS,
    abi: REGISTRY_ABI,
    functionName: "isOrgAdmin",
    args: [orgId, account],
  });
  if (!isAdmin) {
    throw new Error(`Wallet ${account} is not an org admin for org ${orgId.toString()}`);
  }
}

/** POST — create or return existing active consensus for a report */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  try {
    const { onChainReportId, orgId, reporterThreadId, selectedAdmins, creatorAddress, signature } = body as {
      onChainReportId?: string | number | bigint;
      orgId?: string | number | bigint;
      reporterThreadId?: string;
      selectedAdmins?: string[];
      creatorAddress?: string;
      signature?: string;
    };

    if (onChainReportId === undefined || onChainReportId === null) {
      return NextResponse.json({ error: "Missing onChainReportId" }, { status: 400 });
    }
    if (orgId === undefined || orgId === null) {
      return NextResponse.json({ error: "Missing orgId" }, { status: 400 });
    }
    if (!creatorAddress || !signature) {
      return NextResponse.json({ error: "Missing creator signature" }, { status: 400 });
    }

    let onChainReportIdBigInt: bigint;
    let orgIdBigInt: bigint;
    try {
      onChainReportIdBigInt = typeof onChainReportId === "bigint" ? onChainReportId : BigInt(onChainReportId);
      orgIdBigInt = typeof orgId === "bigint" ? orgId : BigInt(orgId);
    } catch {
      return NextResponse.json({ error: "Invalid report or org ID" }, { status: 400 });
    }

    const normalizedAdmins = normalizeConsensusAdmins(selectedAdmins ?? []);
    if (normalizedAdmins.length === 0) {
      return NextResponse.json({ error: "At least one selected admin is required" }, { status: 400 });
    }

    const normalizedCreator = normalizeConsensusAdmins([creatorAddress])[0];
    const message = buildConsensusRequestMessage({
      orgId: orgIdBigInt,
      reportId: onChainReportIdBigInt,
      reporterThreadId,
      selectedAdmins: normalizedAdmins,
      creatorAddress: normalizedCreator,
    });
    const recovered = verifyMessage(message, signature).toLowerCase();
    if (recovered !== normalizedCreator) {
      return NextResponse.json({ error: "Invalid creator signature" }, { status: 401 });
    }

    const publicClient = createConsensusClient();
    const reportCount = await publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: "getReportCount",
      args: [],
    });
    const reportId = onChainReportIdBigInt;
    if (reportId < 0n || reportId >= reportCount) {
      return NextResponse.json({ error: "Unknown on-chain report ID" }, { status: 400 });
    }
    const reportOrgId = await publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: "reportOrgId",
      args: [reportId],
    });
    if (reportOrgId !== orgIdBigInt) {
      return NextResponse.json({ error: "Report does not belong to the specified org" }, { status: 400 });
    }

    await assertOrgAdmin(publicClient, orgIdBigInt, normalizedCreator as `0x${string}`);
    for (const admin of normalizedAdmins) {
      await assertOrgAdmin(publicClient, orgIdBigInt, admin as `0x${string}`);
    }

    const { row, created } = await upsertConsensusRequest({
      onChainReportId: reportId,
      orgId: orgIdBigInt,
      reporterThreadId,
      selectedAdmins: normalizedAdmins,
      metadata: {
        orgId: String(orgIdBigInt),
        creatorAddress: normalizedCreator,
      },
    });
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
