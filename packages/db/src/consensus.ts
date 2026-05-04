import { prisma } from "./client";
import { randomUUID } from "crypto";
import { ethers } from "ethers";

export type CreateConsensusInput = {
    onChainReportId?: bigint | number;
    reporterThreadId?: string;
    selectedAdmins?: string[];
    metadata?: Record<string, unknown>;
};

export async function createConsensusRequest(input: CreateConsensusInput) {
    const id = randomUUID();
    const p = prisma as any;
    const row = await p.reportConsensusRequest.create({
        data: {
            id,
            onChainReportId: input.onChainReportId ? BigInt(input.onChainReportId as any) : null,
            reporterThreadId: input.reporterThreadId ?? null,
            selectedAdmins: input.selectedAdmins ?? [],
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
    if (input.onChainReportId !== undefined && input.onChainReportId !== null) {
        const existing = await findActiveConsensusForReport(input.onChainReportId);
        if (existing) return { row: existing, created: false };
    }
    const row = await createConsensusRequest(input);
    return { row, created: true };
}

export async function addAdminVote(consensusRequestId: string, adminAddress: string, vote: "APPROVE" | "REJECT" | "ESCALATE" | "ABSTAIN", signature?: string, reason?: string, encryptedReason?: string) {
    const p = prisma as any;
    
    // Check if the admin has already voted
    const existing = await p.adminConsensusVote.findFirst({
        where: { consensusRequestId, adminAddress }
    });
    
    if (existing) {
        // Update their existing vote
        return p.adminConsensusVote.update({
            where: { id: existing.id },
            data: {
                vote,
                signature: signature ?? null,
                reason: reason ?? null,
                encryptedReason: encryptedReason ?? null,
                votedAt: new Date()
            }
        });
    }

    return p.adminConsensusVote.create({
        data: {
            consensusRequestId,
            adminAddress,
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

    const assigned = request.selectedAdmins.length;
    let decision: number | null = null; // 1=approve,2=reject,3=escalate
    if (assigned === 0) {
        decision = null;
    } else if (counts.APPROVE * 2 > assigned) {
        decision = 1;
    } else if (counts.REJECT * 2 > assigned) {
        decision = 2;
    } else if (counts.ESCALATE > 0) {
        decision = 3;
    }

    return { request, counts, assigned, decision };
}

export function buildConsensusCommitment(reportId: number, decision: number, timestamp: number, chainId: number) {
    const str = `${reportId}:${decision}:${timestamp}:${chainId}`;
    const bytes = ethers.toUtf8Bytes(str);
    const commitment = ethers.keccak256(bytes);
    return commitment as string;
}

export function signCommitment(commitment: string, signer: ethers.Signer) {
    // signer.signMessage signs the eth personal message of the bytes
    return signer.signMessage(ethers.getBytes(commitment));
}
