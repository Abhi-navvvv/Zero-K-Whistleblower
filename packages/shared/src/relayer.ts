export interface RelayResponse {
    txHash: `0x${string}`;
    settled?: boolean;
    receiptStatus?: "success" | "reverted";
    blockNumber?: string;
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
            idToken: string;
            jwksUri: string;
            orgId: string;
            category: number;
            encryptedCIDHex: `0x${string}`;
        };
    };

/**
 * Send a relay request to the given endpoint.
 *
 * - Public reporter actions (submitReport / submitReportForOrg) use "/api/relay"
 *   directly — no API key required.
 * - Privileged admin actions use "/api/admin-relay", a server-side proxy that
 *   reads RELAY_API_KEY from the server environment and injects it before
 *   forwarding to "/api/relay". This keeps the secret off the browser.
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
        error?: string;
    };

    if (!res.ok || !data.txHash) {
        throw new Error(data.error || `Relayer failed (${res.status})`);
    }

    return {
        txHash: data.txHash,
        settled: data.settled,
        receiptStatus: data.receiptStatus,
        blockNumber: data.blockNumber,
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
