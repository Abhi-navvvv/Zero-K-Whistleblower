import { getAddress, isAddress } from "viem";

export type ConsensusVote = "APPROVE" | "REJECT" | "ESCALATE" | "ABSTAIN";

function canonicalAddress(address: string): string {
    if (!isAddress(address)) {
        throw new Error(`Invalid address: ${address}`);
    }
    return getAddress(address).toLowerCase();
}

export function normalizeConsensusAdmins(addresses: string[]): string[] {
    return Array.from(new Set(addresses.map((address) => canonicalAddress(address).trim()).filter(Boolean))).sort();
}

export function buildConsensusRequestMessage(input: {
    orgId: bigint | number;
    reportId: bigint | number;
    reporterThreadId?: string | null;
    selectedAdmins: string[];
    creatorAddress: string;
}): string {
    const admins = normalizeConsensusAdmins(input.selectedAdmins);
    const creatorAddress = canonicalAddress(input.creatorAddress);
    const threadId = input.reporterThreadId?.trim() ?? "";

    return [
        "ZK-Whistleblower consensus request",
        `Org: ${input.orgId.toString()}`,
        `Report: ${input.reportId.toString()}`,
        `Thread: ${threadId}`,
        `Admins: ${admins.join(",")}`,
        `Creator: ${creatorAddress}`,
    ].join("\n");
}

export function buildConsensusVoteMessage(input: {
    consensusRequestId: string;
    vote: ConsensusVote;
    adminAddress: string;
}): string {
    const adminAddress = canonicalAddress(input.adminAddress);

    return [
        "ZK-Whistleblower consensus vote",
        `Request: ${input.consensusRequestId}`,
        `Vote: ${input.vote}`,
        `Voter: ${adminAddress}`,
    ].join("\n");
}
