import { createPublicClient, http, keccak256, toHex, toBytes } from "viem";
import { sepolia } from "viem/chains";

const REGISTRY_ADDRESS = "0x23CC547B2E0dA83850Fa2fCc19451BE5B805Bc6c";
const RELAYER_ADDRESS = "0xF9790De1DB9F19ca3DD3B9468621fe5EDb85CAd4";

const ABI = [
  {
    type: "function",
    name: "OIDC_AUTHORITY_ROLE",
    inputs: [],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
];

async function main() {
  const client = createPublicClient({
    chain: sepolia,
    transport: http("https://sepolia.infura.io/v3/a17c9e476b394165b06dbd1a0316d996"),
  });

  // 1. Read OIDC_AUTHORITY_ROLE from contract
  const contractRole = await client.readContract({
    address: REGISTRY_ADDRESS,
    abi: ABI,
    functionName: "OIDC_AUTHORITY_ROLE",
  });
  console.log("Contract OIDC_AUTHORITY_ROLE:", contractRole);

  // 2. Compute locally with toHex (what old code did)
  const localRoleToHex = keccak256(toHex("OIDC_AUTHORITY_ROLE"));
  console.log("Local keccak256(toHex(...)):", localRoleToHex);

  // 3. Compute locally with toBytes (what new fallback does)
  const localRoleToBytes = keccak256(toBytes("OIDC_AUTHORITY_ROLE"));
  console.log("Local keccak256(toBytes(...)):", localRoleToBytes);

  // 4. Check match
  console.log("toHex matches contract?", localRoleToHex === contractRole);
  console.log("toBytes matches contract?", localRoleToBytes === contractRole);

  // 5. Check hasRole with contract-read value
  const hasRoleContract = await client.readContract({
    address: REGISTRY_ADDRESS,
    abi: ABI,
    functionName: "hasRole",
    args: [contractRole, RELAYER_ADDRESS],
  });
  console.log(`hasRole(contractRole, ${RELAYER_ADDRESS}):`, hasRoleContract);

  // 6. Check hasRole with toHex-computed value
  const hasRoleToHex = await client.readContract({
    address: REGISTRY_ADDRESS,
    abi: ABI,
    functionName: "hasRole",
    args: [localRoleToHex, RELAYER_ADDRESS],
  });
  console.log(`hasRole(toHex, ${RELAYER_ADDRESS}):`, hasRoleToHex);
}

main().catch(console.error);
