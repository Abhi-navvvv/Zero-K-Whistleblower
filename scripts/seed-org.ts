import { network } from "hardhat";

async function main() {
    const { ethers } = (await network.connect()) as any;
    const [owner] = await ethers.getSigners();

    const registryAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
    console.log("Connecting to WhistleblowerRegistry at:", registryAddress);
    const registry = await ethers.getContractAt("WhistleblowerRegistry", registryAddress);

    const orgId = 10n;
    const exists = await registry.organizationExists(orgId);
    if (!exists) {
        console.log("Creating organization 10 (Bennett University)...");
        const tx = await registry.createOrganization(orgId, "Bennett University");
        await tx.wait();
        console.log("Organization 10 created!");
    } else {
        console.log("Organization 10 already exists.");
    }
}

main().catch(console.error);
