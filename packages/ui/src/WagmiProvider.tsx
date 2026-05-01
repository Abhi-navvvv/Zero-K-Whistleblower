"use client";

/**
 * Providers — wraps the app with WagmiProvider + RainbowKitProvider + React Query.
 *
 * wagmi v2 + RainbowKit v2 require the provider tree to be present on the
 * FIRST render.  The old pattern (lazy async import inside useEffect + return null
 * while loading) caused `WagmiProviderNotFoundError` because wagmi hooks in child
 * components ran before the providers were ever mounted.
 *
 * Fix: create the wagmi config eagerly at module-load time (safe — it only touches
 * browser APIs at call time, not at import time), then import RainbowKitProvider
 * synchronously.  We keep `ssr: false` in the config so WalletConnect never tries
 * to access `indexedDB` on the server.
 */

import { WagmiProvider, type Config as WagmiConfig } from "wagmi";
import { hardhat, sepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { ReactNode, useState } from "react";

const networkName = process.env.NEXT_PUBLIC_NETWORK_NAME?.toLowerCase();
const activeChain = networkName === "sepolia" ? sepolia : hardhat;

// Created once at module scope — this is fine because getDefaultConfig only
// accesses browser storage lazily (on connect), not at construction time.
const wagmiConfig = getDefaultConfig({
  appName: "ZK Whistleblower",
  projectId:
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "placeholder_dev_id",
  chains: [activeChain],
  ssr: false,
}) as WagmiConfig;

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
