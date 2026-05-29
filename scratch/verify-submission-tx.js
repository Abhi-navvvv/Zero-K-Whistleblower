import { ethers } from "ethers";

async function main() {
  const provider = new ethers.JsonRpcProvider("https://sepolia.infura.io/v3/a17c9e476b394165b06dbd1a0316d996");
  const txHash = "0x37c20997f97a43f0e80a007753986f433725fad3611b3a1bc698cc90a252ce4e";
  
  const tx = await provider.getTransaction(txHash);
  if (!tx) {
    console.log("Transaction not found on Sepolia yet.");
    return;
  }
  
  const receipt = await provider.getTransactionReceipt(txHash);
  
  console.log("Transaction details:");
  console.log("  To Contract:", tx.to);
  console.log("  From (Relayer):", tx.from);
  console.log("  Status:", receipt.status === 1 ? "SUCCESS" : "REVERTED");
  console.log("  Block Number:", receipt.blockNumber);
  console.log("  Gas Used:", receipt.gasUsed.toString());
}

main().catch(console.error);
