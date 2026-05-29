import { network } from "hardhat";

async function main() {
    const { ethers } = (await network.connect()) as any;
    const [owner] = await ethers.getSigners();
    const relayer = "0xe55e0a68d02004699824c931Cc5e01B2c8fbD558";

    console.log("Deployer:", owner.address);
    console.log("Relayer:", relayer);

    const balance = await ethers.provider.getBalance(owner.address);
    console.log("Deployer Balance:", ethers.formatEther(balance), "ETH");

    console.log("Sending 0.2 ETH to Relayer...");
    const tx = await owner.sendTransaction({
        to: relayer,
        value: ethers.parseEther("0.2"),
    });
    console.log("Tx hash:", tx.hash);
    await tx.wait();
    console.log("Relayer successfully funded!");
}

main().catch(console.error);
