import {
  clusterApiUrl,
  PublicKey,
} from "@solana/web3.js";

export const NETWORK = "devnet" as const;

export const RPC_ENDPOINT =
  import.meta.env.VITE_SOLANA_RPC_URL?.trim() ||
  clusterApiUrl(NETWORK);

export const PROGRAM_ID =
  new PublicKey(
    import.meta.env.VITE_AMM_PROGRAM_ID?.trim() ||
      "HVyRymResYhpSjAeLfQcabBTD8s15uXVzGZJUH5HjDHC"
  );

  export const DEFAULT_POOL =
  import.meta.env
    .VITE_DEFAULT_POOL
    ?.trim() ||
  "GrxzGzcDGLvpYq1YsbF4FkDhNUSEWvhxHVkoVqP8MeYk";

export function explorerAddressUrl(
  address: string
): string {
  return (
    `https://explorer.solana.com/address/` +
    `${address}?cluster=${NETWORK}`
  );
}

export function explorerTransactionUrl(
  signature: string
): string {
  return (
    `https://explorer.solana.com/tx/` +
    `${signature}?cluster=${NETWORK}`
  );
}