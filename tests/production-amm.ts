import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";

import {
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import { assert } from "chai";

import { ProductionAmm } from "../target/types/production_amm";

/*
 * Different Solana/Anchor error paths can expose the program logs
 * in slightly different properties.
 *
 * Our goal here is simple:
 *
 * transaction error
 *      ↓
 * find program logs
 *      ↓
 * let Anchor parse them
 *      ↓
 * extract custom error code
 */
function getAnchorErrorCode(error: unknown): string | undefined {
  const err = error as {
    error?: {
      errorCode?: {
        code?: string;
      };
    };
    logs?: string[];
    transactionLogs?: string[];
    errorLogs?: string[];
  };

  // Some Anchor errors are already parsed.
  const directCode = err?.error?.errorCode?.code;

  if (directCode) {
    return directCode;
  }

  // Other transaction errors contain raw program logs.
  const logs =
    err?.logs ??
    err?.transactionLogs ??
    err?.errorLogs;

  if (!Array.isArray(logs)) {
    return undefined;
  }

  const parsedError = anchor.AnchorError.parse(logs);

  return parsedError?.error.errorCode.code;
}

describe("production-amm: initialize_pool", () => {
  const provider = anchor.AnchorProvider.env();

  anchor.setProvider(provider);

  const program =
    anchor.workspace.ProductionAmm as Program<ProductionAmm>;

  const payer =
    (provider.wallet as anchor.Wallet).payer;

  let mintA: PublicKey;
  let mintB: PublicKey;

  let token0Mint: PublicKey;
  let token1Mint: PublicKey;

  let poolPda: PublicKey;
  let poolBump: number;

  let vault0: PublicKey;
  let vault1: PublicKey;

  let lpMintPda: PublicKey;

  before(async () => {
    /*
     * Create two arbitrary SPL token mints.
     *
     * The different decimals also demonstrate that our pool can
     * contain tokens with different decimal configurations.
     */
    mintA = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6
    );

    mintB = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      9
    );

    /*
     * Our protocol requires canonical ordering:
     *
     * token_0 < token_1
     *
     * The client sorts them first, but the program independently
     * enforces this invariant on-chain.
     */
    if (
      Buffer.compare(
        mintA.toBuffer(),
        mintB.toBuffer()
      ) < 0
    ) {
      token0Mint = mintA;
      token1Mint = mintB;
    } else {
      token0Mint = mintB;
      token1Mint = mintA;
    }

    /*
     * Pool PDA:
     *
     * ["pool", token_0_mint, token_1_mint]
     */
    [poolPda, poolBump] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("pool"),
          token0Mint.toBuffer(),
          token1Mint.toBuffer(),
        ],
        program.programId
      );

    /*
     * Vault 0:
     *
     * canonical ATA(
     *   owner = Pool PDA,
     *   mint  = token_0
     * )
     */
    vault0 =
      getAssociatedTokenAddressSync(
        token0Mint,
        poolPda,
        true
      );

    /*
     * Vault 1:
     *
     * canonical ATA(
     *   owner = Pool PDA,
     *   mint  = token_1
     * )
     */
    vault1 =
      getAssociatedTokenAddressSync(
        token1Mint,
        poolPda,
        true
      );

    /*
     * LP Mint PDA:
     *
     * ["lp_mint", pool]
     */
    [lpMintPda] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("lp_mint"),
          poolPda.toBuffer(),
        ],
        program.programId
      );
  });

  it("initializes the canonical pool", async () => {
    await program.methods
      .initializePool()
      .accounts({
        initializer:
          provider.wallet.publicKey,

        token0Mint,
        token1Mint,

        pool: poolPda,

        vault0,
        vault1,

        lpMint: lpMintPda,

        systemProgram:
          SystemProgram.programId,

        tokenProgram:
          TOKEN_PROGRAM_ID,

        associatedTokenProgram:
          ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    const pool =
      await program.account.pool.fetch(
        poolPda
      );

    assert.isTrue(
      pool.token0Mint.equals(token0Mint)
    );

    assert.isTrue(
      pool.token1Mint.equals(token1Mint)
    );

    assert.equal(
      pool.bump,
      poolBump
    );
  });

  it(
    "creates vault 0 as the canonical token-0 ATA owned by the pool PDA",
    async () => {
      const expectedVault =
        getAssociatedTokenAddressSync(
          token0Mint,
          poolPda,
          true
        );

      assert.isTrue(
        vault0.equals(expectedVault)
      );

      const account =
        await getAccount(
          provider.connection,
          vault0
        );

      /*
       * Vault 0 must hold token_0.
       */
      assert.isTrue(
        account.mint.equals(token0Mint)
      );

      /*
       * Pool PDA must control Vault 0.
       */
      assert.isTrue(
        account.owner.equals(poolPda)
      );

      /*
       * initialize_pool creates the vault
       * but does not deposit liquidity.
       */
      assert.equal(
        account.amount,
        0n
      );
    }
  );

  it(
    "creates vault 1 as the canonical token-1 ATA owned by the pool PDA",
    async () => {
      const expectedVault =
        getAssociatedTokenAddressSync(
          token1Mint,
          poolPda,
          true
        );

      assert.isTrue(
        vault1.equals(expectedVault)
      );

      const account =
        await getAccount(
          provider.connection,
          vault1
        );

      assert.isTrue(
        account.mint.equals(token1Mint)
      );

      assert.isTrue(
        account.owner.equals(poolPda)
      );

      assert.equal(
        account.amount,
        0n
      );
    }
  );

  it(
    "creates the deterministic LP mint with the pool PDA as mint authority",
    async () => {
      const [expectedLpMint] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("lp_mint"),
            poolPda.toBuffer(),
          ],
          program.programId
        );

      assert.isTrue(
        lpMintPda.equals(
          expectedLpMint
        )
      );

      const mint =
        await getMint(
          provider.connection,
          lpMintPda
        );

      /*
       * Fixed protocol LP decimals.
       */
      assert.equal(
        mint.decimals,
        9
      );

      /*
       * initialize_pool must not mint
       * any LP ownership yet.
       */
      assert.equal(
        mint.supply,
        0n
      );

      assert.isNotNull(
        mint.mintAuthority
      );

      /*
       * Only the Pool PDA can authorize
       * future LP minting.
       */
      assert.isTrue(
        mint.mintAuthority!.equals(
          poolPda
        )
      );
    }
  );

  it(
    "rejects identical token mints",
    async () => {
      const sameMint =
        await createMint(
          provider.connection,
          payer,
          payer.publicKey,
          null,
          6
        );

      const [samePool] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("pool"),
            sameMint.toBuffer(),
            sameMint.toBuffer(),
          ],
          program.programId
        );

      const sameVault =
        getAssociatedTokenAddressSync(
          sameMint,
          samePool,
          true
        );

      const [sameLpMint] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("lp_mint"),
            samePool.toBuffer(),
          ],
          program.programId
        );

      let caughtError: unknown = null;

      try {
        await program.methods
          .initializePool()
          .accounts({
            initializer:
              provider.wallet.publicKey,

            token0Mint:
              sameMint,

            token1Mint:
              sameMint,

            pool:
              samePool,

            vault0:
              sameVault,

            vault1:
              sameVault,

            lpMint:
              sameLpMint,

            systemProgram:
              SystemProgram.programId,

            tokenProgram:
              TOKEN_PROGRAM_ID,

            associatedTokenProgram:
              ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .rpc();
      } catch (error) {
        caughtError = error;
      }

      /*
       * Important:
       *
       * This assertion is OUTSIDE the try/catch.
       *
       * Otherwise assert.fail() itself could be
       * accidentally caught and mistaken for the
       * transaction failure.
       */
      assert.isNotNull(
        caughtError,
        "Expected identical-mint initialization to fail"
      );

      

      const errorCode =
        getAnchorErrorCode(
          caughtError
        );

      assert.equal(
        errorCode,
        "IdenticalMints"
      );
    }
  );

  it(
    "rejects non-canonical mint ordering",
    async () => {
      /*
       * Deliberately reverse the valid
       * canonical ordering.
       */
      const reversedToken0 =
        token1Mint;

      const reversedToken1 =
        token0Mint;

      const [reversedPool] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("pool"),
            reversedToken0.toBuffer(),
            reversedToken1.toBuffer(),
          ],
          program.programId
        );

      const reversedVault0 =
        getAssociatedTokenAddressSync(
          reversedToken0,
          reversedPool,
          true
        );

      const reversedVault1 =
        getAssociatedTokenAddressSync(
          reversedToken1,
          reversedPool,
          true
        );

      const [reversedLpMint] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("lp_mint"),
            reversedPool.toBuffer(),
          ],
          program.programId
        );

      let caughtError: unknown = null;

      try {
        await program.methods
          .initializePool()
          .accounts({
            initializer:
              provider.wallet.publicKey,

            token0Mint:
              reversedToken0,

            token1Mint:
              reversedToken1,

            pool:
              reversedPool,

            vault0:
              reversedVault0,

            vault1:
              reversedVault1,

            lpMint:
              reversedLpMint,

            systemProgram:
              SystemProgram.programId,

            tokenProgram:
              TOKEN_PROGRAM_ID,

            associatedTokenProgram:
              ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .rpc();
      } catch (error) {
        caughtError = error;
      }

      assert.isNotNull(
        caughtError,
        "Expected non-canonical initialization to fail"
      );

      const errorCode =
        getAnchorErrorCode(
          caughtError
        );

      assert.equal(
        errorCode,
        "NonCanonicalMintOrder"
      );
    }
  );

  it(
    "rejects duplicate initialization of the same canonical pool",
    async () => {
      let caughtError: unknown = null;

      try {
        await program.methods
          .initializePool()
          .accounts({
            initializer:
              provider.wallet.publicKey,

            token0Mint,
            token1Mint,

            pool:
              poolPda,

            vault0,
            vault1,

            lpMint:
              lpMintPda,

            systemProgram:
              SystemProgram.programId,

            tokenProgram:
              TOKEN_PROGRAM_ID,

            associatedTokenProgram:
              ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .rpc();
      } catch (error) {
        caughtError = error;
      }

      /*
       * We don't require one of our custom
       * AmmError codes here.
       *
       * Why?
       *
       * The failure comes from Anchor's `init`
       * machinery because the canonical Pool PDA
       * already exists.
       *
       * The important invariant is:
       *
       * one canonical Pool PDA per token pair.
       */
      assert.isNotNull(
        caughtError,
        "Expected duplicate pool initialization to fail"
      );
    }
  );
});