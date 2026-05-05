import { prisma } from "./client";
import { randomUUID } from "crypto";
import { ethers } from "ethers";
import { normalizeConsensusAdmins } from "@zk-whistleblower/shared/src/consensus";

export type CreateConsensusInput = {
    onChainReportId?: bigint | number;
    orgId?: bigint | number;
    reporterThreadId?: string;
    selectedAdmins?: string[];
    metadata?: Record<string, unknown>;
};

export async function createConsensusRequest(input: CreateConsensusInput) {
    const id = randomUUID();
    const p = prisma as any;
    const selectedAdmins = normalizeConsensusAdmins(input.selectedAdmins ?? []);
    if (selectedAdmins.length === 0) {
        throw new Error("At least one selected admin is required");
    }
    const row = await p.reportConsensusRequest.create({
        data: {
            id,
            onChainReportId: input.onChainReportId ? BigInt(input.onChainReportId as any) : null,
            reporterThreadId: input.reporterThreadId ?? null,
            selectedAdmins,
            metadata: input.metadata ?? null,
        },
    });
    return row;
}

/** Find the active (PENDING_REVIEW) consensus request for a given on-chain report ID, if any. */
export async function findActiveConsensusForReport(onChainReportId: number | bigint) {
    const p = prisma as any;
    return p.reportConsensusRequest.findFirst({
        where: {
            onChainReportId: BigInt(onChainReportId as any),
            status: "PENDING_REVIEW",
        },
        include: { votes: true },
        orderBy: { createdAt: "desc" },
    });
}

/**
 * Upsert: if an active consensus already exists for this report, return it.
 * Otherwise create a new one.
 */
export async function upsertConsensusRequest(input: CreateConsensusInput) {
    const selectedAdmins = normalizeConsensusAdmins(input.selectedAdmins ?? []);
    if (selectedAdmins.length === 0) {
        throw new Error("At least one selected admin is required");
    }

    if (input.onChainReportId !== undefined && input.onChainReportId !== null) {
        const existing = await findActiveConsensusForReport(input.onChainReportId);
        if (existing) {
            const existingAdmins = normalizeConsensusAdmins(existing.selectedAdmins ?? []);
            if (existingAdmins.join(",") !== selectedAdmins.join(",")) {
                throw new Error("An active consensus already exists for this report with a different committee");
            }
            return { row: existing, created: false };
        }
    }
    const row = await createConsensusRequest({ ...input, selectedAdmins });
    return { row, created: true };
}

export async function addAdminVote(consensusRequestId: string, adminAddress: string, vote: "APPROVE" | "REJECT" | "ESCALATE" | "ABSTAIN", signature?: string, reason?: string, encryptedReason?: string) {
    const p = prisma as any;
    const normalizedAdminAddress = ethers.getAddress(adminAddress).toLowerCase();

    // Check if the admin has already voted
    const existing = await p.adminConsensusVote.findFirst({
        where: { consensusRequestId, adminAddress: normalizedAdminAddress }
    });

    if (existing) {
        throw new Error("Admin has already voted on this consensus request");
    }

    return p.adminConsensusVote.create({
        data: {
            consensusRequestId,
            adminAddress: normalizedAdminAddress,
            vote,
            signature: signature ?? null,
            reason: reason ?? null,
            encryptedReason: encryptedReason ?? null,
        },
    });
}

export async function computeConsensusResult(consensusRequestId: string) {
    const p = prisma as any;
    const request = await p.reportConsensusRequest.findUnique({ where: { id: consensusRequestId }, include: { votes: true } });
    if (!request) throw new Error("Not found");

    const counts = { APPROVE: 0, REJECT: 0, ESCALATE: 0, ABSTAIN: 0 } as Record<string, number>;
    for (const v of request.votes) counts[v.vote] = (counts[v.vote] ?? 0) + 1;

    const assigned = normalizeConsensusAdmins(request.selectedAdmins ?? []).length;
    let decision: number | null = null; // 1=approve,2=reject,3=escalate
    if (assigned === 0) {
        decision = null;
    } else if (counts.APPROVE * 3 > assigned * 2) {
        decision = 1;
    } else if (counts.REJECT * 3 > assigned * 2) {
        decision = 2;
    } else if (counts.ESCALATE * 3 > assigned * 2) {
        decision = 3;
    }

    return { request, counts, assigned, decision };
}

export function buildConsensusCommitment(reportId: number, decision: number, timestamp: number, chainId: number) {
    // Match Solidity: keccak256(abi.encodePacked(reportId, decision, timestamp, chainId))
    const packed = ethers.solidityPacked(
        ["uint256", "uint8", "uint256", "uint256"],
        [BigInt(reportId), BigInt(decision), BigInt(timestamp), BigInt(chainId)]
    );
    const commitment = ethers.keccak256(packed);
    return commitment as string;
}

export function signCommitment(commitment: string, signer: ethers.Signer) {
    // signer.signMessage signs the eth personal message of the bytes
    return signer.signMessage(ethers.getBytes(commitment));
}
