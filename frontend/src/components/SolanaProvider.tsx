import {
  type PropsWithChildren,
} from "react";

import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";

import {
  WalletModalProvider,
} from "@solana/wallet-adapter-react-ui";

import {
  RPC_ENDPOINT,
} from "../config/solana";

export function SolanaProvider({
  children,
}: PropsWithChildren) {
  return (
    <ConnectionProvider
      endpoint={RPC_ENDPOINT}
    >
      <WalletProvider
        wallets={[]}
        autoConnect
      >
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}