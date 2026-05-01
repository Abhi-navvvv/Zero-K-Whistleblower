"use client";

/**
 * Providers — WagmiProvider + RainbowKitProvider + React Query.
 *
 * The config is created lazily on first client render (via useState initializer)
 * so it never runs during SSR/static prerendering where indexedDB doesn't exist.
 * The providers are always rendered (never null) so wagmi hooks in children
 * always have a valid context — fixing WagmiProviderNotFoundError.
 *
 * The admin/reporter pages are marked `dynamic = "force-dynamic"` to prevent
 * Next.js from attempting to statically prerender pages that use wagmi hooks.
 */

import { WagmiProvider, type Config as WagmiConfig } from "wagmi";
import { hardhat, sepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { ReactNode, useState } from "react";

const networkName = process.env.NEXT_PUBLIC_NETWORK_NAME?.toLowerCase();
const activeChain = networkName === "sepolia" ? sepolia : hardhat;

function createWagmiConfig(): WagmiConfig {
  // Dynamic import is safe here because this function only runs client-side
  // (called inside useState initializer which is client-only).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getDefaultConfig } = require("@rainbow-me/rainbowkit") as typeof import("@rainbow-me/rainbowkit");
  return getDefaultConfig({
    appName: "ZK Whistleblower",
    projectId:
      process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "placeholder_dev_id",
    chains: [activeChain],
    ssr: true,
  }) as WagmiConfig;
}

export default function Providers({ children }: { children: ReactNode }) {
  // useState initializer runs once, client-side only — safe from SSR crashes.
  const [wagmiConfig] = useState<WagmiConfig>(createWagmiConfig);
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
