import { NextRequest, NextResponse } from "next/server";
import { BaseError, createPublicClient, createWalletClient, http, encodePacked, keccak256, toHex, toBytes, hexToBigInt, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat, sepolia } from "viem/chains";
import { REGISTRY_ABI, REGISTRY_ADDRESS } from "@zk-whistleblower/shared/src/contracts";
import { timingSafeEqual } from "crypto";
import path from "path";
import fs from "fs";
import { b64urlToBigInt, modPow } from "@zk-whistleblower/shared/src/blindSign";

export const runtime = "nodejs";

const STORAGE_DIR = path.join(process.cwd(), "data");

function getStoragePath(filename: string): string {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
  return path.join(STORAGE_DIR, filename);
}

/**
 * Helper to safely compare strings in constant time to prevent timing attacks
 */
function safeCompare(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch (e) {
    return false;
  }
}

type RelayAction =
    | "addRoot"
    | "addRootForOrg"
    | "revokeRoot"
    | "revokeRootForOrg"
    | "createOrganization"
    | "setOrganizationActive"
    | "grantOrgAdmin"
    | "revokeOrgAdmin"
    | "submitReport"
    | "submitReportForOrg"
    | "submitReportWithOidc";

function asBigInt(value: unknown, field: string): bigint {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${field} must be a non-empty string`);
    }
    return BigInt(value);
}

function asAddress(value: unknown, field: string): `0x${string}` {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
        throw new Error(`${field} must be a valid 20-byte hex address`);
    }
    return value as `0x${string}`;
}

function readConfig() {
    const rpcUrl = process.env.RELAYER_RPC_URL || process.env.SEPOLIA_RPC_URL;
    const privateKey = process.env.RELAYER_PRIVATE_KEY || process.env.SEPOLIA_PRIVATE_KEY;

    if (!rpcUrl) throw new Error("Missing RELAYER_RPC_URL");
    if (!privateKey) throw new Error("Missing RELAYER_PRIVATE_KEY");

    const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
    return { rpcUrl, privateKey: normalizedKey as `0x${string}` };
}

function readChain() {
    const chainIdRaw = process.env.RELAYER_CHAIN_ID?.trim();
    const networkRaw = process.env.NEXT_PUBLIC_NETWORK_NAME?.trim().toLowerCase();

    if (chainIdRaw) {
        const chainId = Number(chainIdRaw);
        if (chainId === hardhat.id) return hardhat;
        if (chainId === sepolia.id) return sepolia;
        throw new Error(`Unsupported RELAYER_CHAIN_ID: ${chainIdRaw}. Use ${hardhat.id} (hardhat) or ${sepolia.id} (sepolia).`);
    }

    if (networkRaw === "sepolia") return sepolia;
    return hardhat;
}

async function ensureOrganizationApisAvailable(publicClient: ReturnType<typeof createPublicClient>) {
    try {
        await publicClient.readContract({
            address: REGISTRY_ADDRESS,
            abi: REGISTRY_ABI,
            functionName: "organizationExists",
            args: [0n],
        });
    } catch {
        throw new Error(
            "This deployed registry does not support organization APIs. Redeploy the latest WhistleblowerRegistry and update NEXT_PUBLIC_REGISTRY_ADDRESS."
        );
    }
}

function getErrorMessage(error: unknown): string {
    if (error instanceof BaseError) {
        const messages: string[] = [];
        let current: unknown = error;
        while (current instanceof BaseError) {
            if (current.shortMessage && !messages.includes(current.shortMessage)) {
                messages.push(current.shortMessage);
            }
            if (current.details && !messages.includes(current.details)) {
                messages.push(current.details);
            }
            current = current.cause;
        }
        return messages.join(". ");
    }
    return error instanceof Error ? error.message : String(error);
}

// ─── Transaction Queue Worker ──────────────────────────────────────────────────

const globalObj = globalThis as any;

async function processQueue() {
  if (globalObj.isQueueProcessing) return;
  globalObj.isQueueProcessing = true;

  try {
    const queuePath = getStoragePath("tx-queue.json");
    if (!fs.existsSync(queuePath)) return;

    let queue: Record<string, any> = {};
    try {
      queue = JSON.parse(fs.readFileSync(queuePath, "utf-8"));
    } catch {
      return;
    }

    const queuedIds = Object.keys(queue).filter(id => queue[id].status === "QUEUED");
    if (queuedIds.length === 0) return;

    // Shuffle queued IDs to prevent network timing linkability / correlation
    const shuffledIds = queuedIds.sort(() => Math.random() - 0.5);

    const { rpcUrl, privateKey } = readConfig();
    const account = privateKeyToAccount(privateKey);
    const chain = readChain();
    const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

    for (const id of shuffledIds) {
      const item = queue[id];
      item.status = "BROADCASTING";
      fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), "utf-8");

      try {
        let txHash: `0x${string}`;

        if (item.action === "submitReportWithOidc") {
          const { orgId, nullifierHash, encryptedCIDHex, category } = item.payload;
          const orgIdBigInt = asBigInt(String(orgId), "orgId");
          const categoryNumber = Number(category);
          const nullifierHashBigInt = BigInt(nullifierHash);

          // Generate authority signature
          const messageHash = keccak256(
              encodePacked(
                  ["uint256", "uint256", "bytes", "uint8"],
                  [orgIdBigInt, nullifierHashBigInt, encryptedCIDHex as `0x${string}`, categoryNumber]
              )
          );
          const signature = await account.signMessage({
              message: { raw: toBytes(messageHash) }
          });
          const submitArgs = [
              orgIdBigInt,
              nullifierHashBigInt,
              encryptedCIDHex as `0x${string}`,
              categoryNumber,
              signature
          ] as const;

          await ensureOrganizationApisAvailable(publicClient);

          txHash = await walletClient.writeContract({
              address: REGISTRY_ADDRESS,
              abi: REGISTRY_ABI,
              functionName: "submitReportWithOidc",
              args: submitArgs,
              account,
          });
        } else {
          // ZK submissions: submitReport or submitReportForOrg
          const pA = item.payload.pA as [string, string];
          const pB = item.payload.pB as [[string, string], [string, string]];
          const pC = item.payload.pC as [string, string];
          const category = Number(item.payload.category);
          const encryptedCIDHex = item.payload.encryptedCIDHex;

          const commonArgs = [
              [asBigInt(pA[0], "pA[0]"), asBigInt(pA[1], "pA[1]")],
              [
                  [asBigInt(pB[0][0], "pB[0][0]"), asBigInt(pB[0][1], "pB[0][1]")],
                  [asBigInt(pB[1][0], "pB[1][0]"), asBigInt(pB[1][1], "pB[1][1]")],
              ],
              [asBigInt(pC[0], "pC[0]"), asBigInt(pC[1], "pC[1]")],
              asBigInt(item.payload.root, "root"),
              asBigInt(item.payload.nullifierHash, "nullifierHash"),
              asBigInt(item.payload.externalNullifier, "externalNullifier"),
              encryptedCIDHex as `0x${string}`,
              category,
          ] as const;

          if (item.action === "submitReportForOrg") {
              await ensureOrganizationApisAvailable(publicClient);
              txHash = await walletClient.writeContract({
                  address: REGISTRY_ADDRESS,
                  abi: REGISTRY_ABI,
                  functionName: "submitReportForOrg",
                  args: [asBigInt(item.payload.orgId, "orgId"), ...commonArgs],
                  account,
              });
          } else {
              txHash = await walletClient.writeContract({
                  address: REGISTRY_ADDRESS,
                  abi: REGISTRY_ABI,
                  functionName: "submitReport",
                  args: commonArgs,
                  account,
              });
          }
        }

        // Wait for confirmation
        const receipt = await publicClient.waitForTransactionReceipt({
            hash: txHash,
            timeout: 120_000,
        });

        if (receipt.status !== "success") {
            item.status = "FAILED";
            item.error = "Transaction reverted on chain";
            item.txHash = txHash;
        } else {
            item.status = "SUCCESS";
            item.txHash = txHash;
            item.blockNumber = receipt.blockNumber.toString();
        }
      } catch (err: unknown) {
        item.status = "FAILED";
        item.error = getErrorMessage(err);
      }

      item.processedAt = new Date().toISOString();
      fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), "utf-8");
    }
  } catch (err) {
    console.error("Queue worker error during processing:", err);
  } finally {
    globalObj.isQueueProcessing = false;
  }
}

// Start queue worker check interval once globally
if (!globalObj.isQueueWorkerRunning) {
  globalObj.isQueueWorkerRunning = true;
  setInterval(async () => {
    try {
      await processQueue();
    } catch (err) {
      console.error("Queue worker failed to execute:", err);
    }
  }, 10000); // Poll queue every 10 seconds
}

// ─── API Routes ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const queueId = searchParams.get("id");
    if (!queueId) {
      return NextResponse.json({ error: "Missing queue transaction ID" }, { status: 400 });
    }

    const queuePath = getStoragePath("tx-queue.json");
    if (!fs.existsSync(queuePath)) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const queue = JSON.parse(fs.readFileSync(queuePath, "utf-8")) as Record<string, any>;
    const item = queue[queueId];
    if (!item) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    return NextResponse.json({
      status: item.status,
      txHash: item.txHash,
      error: item.error,
      blockNumber: item.blockNumber,
      settled: item.status === "SUCCESS" || item.status === "FAILED",
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
    try {
        const { rpcUrl, privateKey } = readConfig();
        const body = (await req.json()) as {
            action?: RelayAction;
            payload?: Record<string, unknown>;
        };

        if (!body?.action || !body.payload) {
            return NextResponse.json({ error: "Invalid relayer payload" }, { status: 400 });
        }

        const isPublicAction = body.action === "submitReport" || body.action === "submitReportForOrg" || body.action === "submitReportWithOidc";
        if (!isPublicAction) {
            const expectedKey = process.env.RELAY_API_KEY;
            if (!expectedKey) {
                return NextResponse.json(
                    { error: "Server misconfiguration — RELAY_API_KEY not set. Contact administrator." },
                    { status: 500 }
                );
            }
            const providedKey = req.headers.get("x-api-key");
            if (!safeCompare(providedKey, expectedKey)) {
                return NextResponse.json(
                    { error: "Unauthorized — invalid or missing API key" },
                    { status: 401 }
                );
            }
        }

        const account = privateKeyToAccount(privateKey);
        const chain = readChain();
        const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
        const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

        let txHash: `0x${string}`;

        if (isPublicAction) {
            // Option C: verify OIDC blind signature first
            if (body.action === "submitReportWithOidc") {
                const { nullifierHash, unblindedSignature } = body.payload;
                if (!nullifierHash || !unblindedSignature) {
                    return NextResponse.json({ error: "Missing nullifierHash or unblindedSignature" }, { status: 400 });
                }

                const keyPath = getStoragePath("blind-sign-key.json");
                if (!fs.existsSync(keyPath)) {
                    return NextResponse.json({ error: "OIDC blind signing key is not initialized on the relayer" }, { status: 500 });
                }

                const keys = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
                const N = b64urlToBigInt(keys.publicKey.n);
                const e = b64urlToBigInt(keys.publicKey.e);

                const msgVal = BigInt(String(nullifierHash));
                const sigVal = BigInt("0x" + String(unblindedSignature));

                const isValid = modPow(sigVal, e, N) === msgVal;
                if (!isValid) {
                    return NextResponse.json({ error: "Invalid OIDC blind signature — transaction rejected" }, { status: 401 });
                }
            }

            // Push to local queue file for delayed batch broadcasting
            const queueId = crypto.randomUUID();
            const queuePath = getStoragePath("tx-queue.json");
            const queue = fs.existsSync(queuePath) ? JSON.parse(fs.readFileSync(queuePath, "utf-8")) : {};

            queue[queueId] = {
                id: queueId,
                action: body.action,
                payload: body.payload,
                status: "QUEUED",
                createdAt: new Date().toISOString(),
            };

            fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), "utf-8");

            return NextResponse.json({
                queued: true,
                id: queueId,
                message: "Report received and queued for broadcast. For security, it will be published within ~60 seconds."
            });
        }

        // Administrative actions run synchronously
        if (body.action === "addRoot") {
            txHash = await walletClient.writeContract({
                address: REGISTRY_ADDRESS,
                abi: REGISTRY_ABI,
                functionName: "addRoot",
                args: [asBigInt(body.payload.root, "root")],
                account,
            });
        } else if (body.action === "addRootForOrg") {
            await ensureOrganizationApisAvailable(publicClient);
            txHash = await walletClient.writeContract({
                address: REGISTRY_ADDRESS,
                abi: REGISTRY_ABI,
                functionName: "addRootForOrg",
                args: [
                    asBigInt(body.payload.orgId, "orgId"),
                    asBigInt(body.payload.root, "root"),
                ],
                account,
            });
        } else if (body.action === "revokeRoot") {
            txHash = await walletClient.writeContract({
                address: REGISTRY_ADDRESS,
                abi: REGISTRY_ABI,
                functionName: "revokeRoot",
                args: [asBigInt(body.payload.root, "root")],
                account,
            });
        } else if (body.action === "revokeRootForOrg") {
            await ensureOrganizationApisAvailable(publicClient);
            txHash = await walletClient.writeContract({
                address: REGISTRY_ADDRESS,
                abi: REGISTRY_ABI,
                functionName: "revokeRootForOrg",
                args: [
                    asBigInt(body.payload.orgId, "orgId"),
                    asBigInt(body.payload.root, "root"),
                ],
                account,
            });
        } else if (body.action === "createOrganization") {
            await ensureOrganizationApisAvailable(publicClient);
            const name = body.payload.name;
            if (typeof name !== "string" || !name.trim()) {
                return NextResponse.json({ error: "Invalid organization name" }, { status: 400 });
            }

            const orgId = asBigInt(body.payload.orgId, "orgId");
            const exists = await publicClient.readContract({
                address: REGISTRY_ADDRESS,
                abi: REGISTRY_ABI,
                functionName: "organizationExists",
                args: [orgId],
            });
            if (exists) {
                return NextResponse.json(
                    { error: `Organization ${orgId.toString()} already exists` },
                    { status: 409 }
                );
            }

            txHash = await walletClient.writeContract({
                address: REGISTRY_ADDRESS,
                abi: REGISTRY_ABI,
                functionName: "createOrganization",
                args: [orgId, name.trim()],
                account,
            });
        } else if (body.action === "setOrganizationActive") {
            await ensureOrganizationApisAvailable(publicClient);
            const active = body.payload.active;
            if (typeof active !== "boolean") {
                return NextResponse.json({ error: "Invalid active flag" }, { status: 400 });
            }
            txHash = await walletClient.writeContract({
                address: REGISTRY_ADDRESS,
                abi: REGISTRY_ABI,
                functionName: "setOrganizationActive",
                args: [asBigInt(body.payload.orgId, "orgId"), active],
                account,
            });
        } else if (body.action === "grantOrgAdmin") {
            await ensureOrganizationApisAvailable(publicClient);
            txHash = await walletClient.writeContract({
                address: REGISTRY_ADDRESS,
                abi: REGISTRY_ABI,
                functionName: "grantOrgAdmin",
                args: [
                    asBigInt(body.payload.orgId, "orgId"),
                    asAddress(body.payload.account, "account"),
                ],
                account,
            });
        } else if (body.action === "revokeOrgAdmin") {
            await ensureOrganizationApisAvailable(publicClient);
            txHash = await walletClient.writeContract({
                address: REGISTRY_ADDRESS,
                abi: REGISTRY_ABI,
                functionName: "revokeOrgAdmin",
                args: [
                    asBigInt(body.payload.orgId, "orgId"),
                    asAddress(body.payload.account, "account"),
                ],
                account,
            });
        } else {
            return NextResponse.json({ error: "Unsupported administrative action" }, { status: 400 });
        }

        const receipt = await publicClient.waitForTransactionReceipt({
            hash: txHash,
            timeout: 120_000,
        });

        if (receipt.status !== "success") {
            return NextResponse.json(
                { error: "Transaction reverted", txHash, receiptStatus: receipt.status },
                { status: 500 }
            );
        }

        return NextResponse.json({
            txHash,
            receiptStatus: receipt.status,
            blockNumber: receipt.blockNumber.toString(),
            settled: true,
        });
    } catch (error) {
        const message = getErrorMessage(error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
