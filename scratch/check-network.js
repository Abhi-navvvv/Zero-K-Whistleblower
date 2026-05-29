import { ethers } from "ethers";

async function main() {
  const provider = new ethers.JsonRpcProvider("https://sepolia.infura.io/v3/a17c9e476b394165b06dbd1a0316d996");
  const network = await provider.getNetwork();
  const blockNumber = await provider.getBlockNumber();
  console.log("Connected to Network:", network.name, "ChainID:", network.chainId.toString(), "Block:", blockNumber);
}

main().catch(console.error);
