import { ethers } from "ethers";

async function main() {
  const provider = new ethers.JsonRpcProvider("https://sepolia.infura.io/v3/a17c9e476b394165b06dbd1a0316d996");
  
  const deployer = "0x9d5f80b953d34c750f1b0d5cce5591c63b79717d";
  const relayer = "0xe55e0a68d02004699824c931cc5e01b2c8fbd558";

  const deployerBal = await provider.getBalance(deployer);
  const relayerBal = await provider.getBalance(relayer);

  console.log("Deployer:", deployer, "Balance:", ethers.formatEther(deployerBal), "ETH");
  console.log("Relayer:", relayer, "Balance:", ethers.formatEther(relayerBal), "ETH");
}

main().catch(console.error);
