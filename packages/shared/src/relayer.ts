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

// ── Privileged admin actions — routed through /api/admin-relay ─────────────
// The admin-relay route is a server-side proxy that reads RELAY_API_KEY from
// the server environment and injects it before forwarding to /api/relay.
// This prevents the secret from ever reaching the browser.
const ADMIN_RELAY = "/api/admin-relay";

export function relayAddRoot(root: string) {
    return relayTx({ action: "addRoot", payload: { root } }, ADMIN_RELAY);
}

export function relayAddRootForOrg(orgId: number, root: string) {
    return relayTx({ action: "addRootForOrg", payload: { orgId: String(orgId), root } }, ADMIN_RELAY);
}

export function relayRevokeRoot(root: string) {
    return relayTx({ action: "revokeRoot", payload: { root } }, ADMIN_RELAY);
}

export function relayRevokeRootForOrg(orgId: number, root: string) {
    return relayTx({ action: "revokeRootForOrg", payload: { orgId: String(orgId), root } }, ADMIN_RELAY);
}

export function relayCreateOrganization(orgId: number, name: string) {
    return relayTx({ action: "createOrganization", payload: { orgId: String(orgId), name } }, ADMIN_RELAY);
}

export function relaySetOrganizationActive(orgId: number, active: boolean) {
    return relayTx({ action: "setOrganizationActive", payload: { orgId: String(orgId), active } }, ADMIN_RELAY);
}

export function relayGrantOrgAdmin(orgId: number, account: string) {
    return relayTx({ action: "grantOrgAdmin", payload: { orgId: String(orgId), account } }, ADMIN_RELAY);
}

export function relayRevokeOrgAdmin(orgId: number, account: string) {
    return relayTx({ action: "revokeOrgAdmin", payload: { orgId: String(orgId), account } }, ADMIN_RELAY);
}

// ── Public reporter actions — no API key required ───────────────────────────

export function relaySubmitReport(
    payload: Extract<RelayRequest, { action: "submitReport" }>['payload']
) {
    return relayTx({ action: "submitReport", payload });
}

export function relaySubmitReportForOrg(
    payload: Extract<RelayRequest, { action: "submitReportForOrg" }>['payload']
) {
    return relayTx({ action: "submitReportForOrg", payload });
}
