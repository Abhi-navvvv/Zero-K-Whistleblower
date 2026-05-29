import { ethers } from "ethers";

const REGISTRY_ADDRESS = "0xab9D9aA2B1a37Cb89d34a123da7d4eC5A998060C";
const RPC_URL = "https://sepolia.infura.io/v3/a17c9e476b394165b06dbd1a0316d996";

const REGISTRY_ABI = [
  "function DEFAULT_ORG_ID() view returns (uint256)",
  "function verifier() view returns (address)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);

  try {
    const defaultOrg = await registry.DEFAULT_ORG_ID();
    console.log("DEFAULT_ORG_ID:", defaultOrg.toString());

    const verifier = await registry.verifier();
    console.log("Verifier Address:", verifier);
  } catch (err) {
    console.error("Error calling contract:", err);
  }
}

main();
