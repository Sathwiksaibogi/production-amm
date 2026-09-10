import {
  AnchorProvider,
  Program,
} from "@coral-xyz/anchor";

import type {
  AnchorWallet,
} from "@solana/wallet-adapter-react";

import {
  PublicKey,
  type Connection,
} from "@solana/web3.js";

import idl from "../idl/production_amm.json";

import type {
  ProductionAmm,
} from "../idl/production_amm";

import {
  PROGRAM_ID,
} from "../config/solana";

/**
 * Creates an Anchor provider for the browser.
 *
 * The connected wallet comes from Solana Wallet Adapter.
 * The frontend never has access to the user's private key.
 */
export function createAmmProvider(
  connection: Connection,
  wallet: AnchorWallet
): AnchorProvider {
  return new AnchorProvider(
    connection,
    wallet,
    {
      commitment: "confirmed",
      preflightCommitment:
        "confirmed",
    }
  );
}

/**
 * Creates the typed Anchor client for our AMM.
 */
export function createAmmProgram(
  connection: Connection,
  wallet: AnchorWallet
): Program<ProductionAmm> {
  const idlProgramId =
    new PublicKey(
      idl.address
    );

  /*
   * Defensive check:
   *
   * If someone accidentally copies an IDL
   * generated for another deployment, we
   * fail immediately rather than interacting
   * with an unexpected program.
   */
  if (
    !idlProgramId.equals(
      PROGRAM_ID
    )
  ) {
    throw new Error(
      "IDL program ID does not match the configured AMM program ID."
    );
  }

  const provider =
    createAmmProvider(
      connection,
      wallet
    );

  return new Program<ProductionAmm>(
    idl as ProductionAmm,
    provider
  );
}