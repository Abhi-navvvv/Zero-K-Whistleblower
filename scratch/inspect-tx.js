import { ethers } from "ethers";

async function main() {
  const provider = new ethers.JsonRpcProvider("https://sepolia.infura.io/v3/a17c9e476b394165b06dbd1a0316d996");
  const txHash = "0x7c97a29d5c519136235b95eeb35f800ab6cfd7f5eec49bf570b1a490ea1f3ac0";
  const tx = await provider.getTransaction(txHash);
  if (!tx) {
    console.log("Transaction not found");
    return;
  }
  const sender = tx.from;
  const balance = await provider.getBalance(sender);
  console.log("Active Deployer Address:", sender);
  console.log("Balance of Active Deployer:", ethers.formatEther(balance), "ETH");
}

main().catch(console.error);
