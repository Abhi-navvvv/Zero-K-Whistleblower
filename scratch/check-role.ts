import { ethers } from "hardhat";

const REGISTRY_ADDRESS = "0xab9D9aA2B1a37Cb89d34a123da7d4eC5A998060C";
const RELAYER_PRIVATE_KEY = "0xf036dcff40febb488d1bcffde4fbaef2a85ec8a5857b4818d6cc6f69966d979b";

async function main() {
  const wallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, ethers.provider);
  console.log("Relayer Address derived from private key:", wallet.address);

  const registry = await ethers.getContractAt("WhistleblowerRegistry", REGISTRY_ADDRESS);
  
  try {
    const oidcRole = await registry.OIDC_AUTHORITY_ROLE();
    console.log("OIDC_AUTHORITY_ROLE Hash:", oidcRole);

    const hasRole = await registry.hasRole(oidcRole, wallet.address);
    console.log(`Does relayer ${wallet.address} have OIDC_AUTHORITY_ROLE?`, hasRole);

    // Let's also check organization exists and active status
    const orgId = 1n; // Default or target orgId
    const orgExists = await registry.organizationExists(orgId);
    console.log(`Does org ${orgId} exist?`, orgExists);

    if (orgExists) {
      const org = await registry.getOrganization(orgId);
      console.log(`Org ${orgId} active status:`, org.active);
    }
  } catch (err) {
    console.error("Error calling contract:", err);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
