import { ethers } from "ethers";

const key = "0xf036dcff40febb488d1bcffde4fbaef2a85ec8a5857b4818d6cc6f69966d979b";
const wallet = new ethers.Wallet(key);
console.log("Derived Relayer Address:", wallet.address);
