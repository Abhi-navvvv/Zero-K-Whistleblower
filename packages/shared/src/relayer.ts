export interface RelayResponse {
    txHash?: `0x${string}`;
    settled?: boolean;
    receiptStatus?: "success" | "reverted";
    blockNumber?: string;
    queued?: boolean;
    id?: string;
}

type RelayRequest =
    | { action: "addRoot"; payload: { root: string } }
    | { action: "addRootForOrg"; payload: { orgId: string; root: string } }
    | { action: "revokeRoot"; payload: { root: string } }
    | { action: "revokeRootForOrg"; payload: { orgId: string; root: string } }
    | { action: "createOrganization"; payload: { orgId: string; name: string } }
    | { action: "setOrganizationActive"; payload: { orgId: string; active: boolean } }
    | { action: "grantOrgAdmin"; payload: { orgId: string; account: string } }
    | { action: "revokeOrgAdmin"; payload: { orgId: string; account: string } }
    | {
        action: "submitReport";
        payload: {
            pA: [string, string];
            pB: [[string, string], [string, string]];
            pC: [string, string];
            root: string;
            nullifierHash: string;
            externalNullifier: string;
            encryptedCIDHex: `0x${string}`;
            category: number;
        };
    }
    | {
        action: "submitReportForOrg";
        payload: {
            orgId: string;
            pA: [string, string];
            pB: [[string, string], [string, string]];
            pC: [string, string];
            root: string;
            nullifierHash: string;
            externalNullifier: string;
            encryptedCIDHex: `0x${string}`;
            category: number;
        };
    }
    | {
        action: "submitReportWithOidc";
        payload: {
            orgId: string;
            category: number;
            encryptedCIDHex: `0x${string}`;
            nullifierHash: string;
            unblindedSignature: string;
        };
    };

/**
 * Send a relay request to the given endpoint.
 */
async function relayTx(body: RelayRequest, endpoint = "/api/relay"): Promise<RelayResponse> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };

    const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => ({}))) as {
        txHash?: `0x${string}`;
        settled?: boolean;
        receiptStatus?: "success" | "reverted";
        blockNumber?: string;
        queued?: boolean;
        id?: string;
        error?: string;
    };

    if (!res.ok || (!data.txHash && !data.queued)) {
        throw new Error(data.error || `Relayer failed (${res.status})`);
    }

    return {
        txHash: data.txHash,
        settled: data.settled,
        receiptStatus: data.receiptStatus,
        blockNumber: data.blockNumber,
        queued: data.queued,
        id: data.id,
    };
}

const ADMIN_RELAY = "/api/admin-relay";

export async function relayAction(
    action: RelayRequest["action"],
    payload: Record<string, unknown>,
    useAdminRelay = false
): Promise<RelayResponse> {
    return relayTx({ action, payload } as RelayRequest, useAdminRelay ? ADMIN_RELAY : undefined);
}
