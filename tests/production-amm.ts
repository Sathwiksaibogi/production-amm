import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  AuthorityType,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  setAuthority,
} from "@solana/spl-token";

import {
  Keypair,
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

async function expectAnchorError(
  promise: Promise<unknown>,
  expectedCode: string
): Promise<void> {
  let caughtError: unknown = null;

  try {
    await promise;
  } catch (error) {
    caughtError = error;
  }

  assert.isNotNull(
    caughtError,
    `Expected transaction to fail with ${expectedCode}`
  );

  assert.equal(
    getAnchorErrorCode(caughtError),
    expectedCode
  );
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
  let lockAuthority: PublicKey;
  let lockedLpAccount: PublicKey;

  async function revokeMintAuthority(mint: PublicKey): Promise<void> {
    await setAuthority(
      provider.connection,
      payer,
      mint,
      payer,
      AuthorityType.MintTokens,
      null
    );
  }

  function deriveLockAccounts(
    pool: PublicKey,
    lpMint: PublicKey
  ): {
    lockAuthority: PublicKey;
    lockedLpAccount: PublicKey;
  } {
    const [lockAuthority] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("lock_authority"),
          pool.toBuffer(),
        ],
        program.programId
      );

    const lockedLpAccount =
      getAssociatedTokenAddressSync(
        lpMint,
        lockAuthority,
        true
      );

    return {
      lockAuthority,
      lockedLpAccount,
    };
  }

async function createCanonicalMintPairWithMintAuthority(
  mintAuthoritySide: 0 | 1
): Promise<{
  token0Mint: PublicKey;
  token1Mint: PublicKey;
}> {
  const mintAKeypair = Keypair.generate();
  const mintBKeypair = Keypair.generate();

  const mintAIsToken0 =
    Buffer.compare(
      mintAKeypair.publicKey.toBuffer(),
      mintBKeypair.publicKey.toBuffer()
    ) < 0;

  const token0Keypair = mintAIsToken0
    ? mintAKeypair
    : mintBKeypair;

  const token1Keypair = mintAIsToken0
    ? mintBKeypair
    : mintAKeypair;

  /*
   * Both mints must initially be created with
   * a valid mint authority.
   */
  const token0Mint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    6,
    token0Keypair
  );

  const token1Mint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    6,
    token1Keypair
  );

  /*
   * Leave mint authority enabled only on the
   * side we intentionally want to test.
   *
   * The other mint has its authority permanently
   * revoked so that only ONE mint violates the rule.
   */
  if (mintAuthoritySide === 0) {
    await setAuthority(
      provider.connection,
      payer,
      token1Mint,
      payer,
      AuthorityType.MintTokens,
      null
    );
  } else {
    await setAuthority(
      provider.connection,
      payer,
      token0Mint,
      payer,
      AuthorityType.MintTokens,
      null
    );
  }

  return {
    token0Mint,
    token1Mint,
  };
}

  async function createCanonicalMintPairWithFreezeAuthority(
    freezeSide: 0 | 1
  ): Promise<{
    token0Mint: PublicKey;
    token1Mint: PublicKey;
  }> {
    const freezeAuthority = Keypair.generate();

    const mintAKeypair = Keypair.generate();
    const mintBKeypair = Keypair.generate();

    const mintAIsToken0 =
      Buffer.compare(
        mintAKeypair.publicKey.toBuffer(),
        mintBKeypair.publicKey.toBuffer()
      ) < 0;

    const token0Keypair = mintAIsToken0
      ? mintAKeypair
      : mintBKeypair;

    const token1Keypair = mintAIsToken0
      ? mintBKeypair
      : mintAKeypair;

    const token0Mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      freezeSide === 0
        ? freezeAuthority.publicKey
        : null,
      6,
      token0Keypair
    );

    const token1Mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      freezeSide === 1
        ? freezeAuthority.publicKey
        : null,
      6,
      token1Keypair
    );

    // Keep the requested freeze authority, but permanently revoke
    // minting authority on both test mints. This prepares the suite
    // for the AMM's future mint-authority restriction.
    await revokeMintAuthority(token0Mint);
    await revokeMintAuthority(token1Mint);

    return {
      token0Mint,
      token1Mint,
    };
  }

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

    // These initialization tests do not need to mint any token supply,
    // so revoke minting authority before the pool is initialized.
    await revokeMintAuthority(mintA);
    await revokeMintAuthority(mintB);

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

    ({
      lockAuthority,
      lockedLpAccount,
    } = deriveLockAccounts(
      poolPda,
      lpMintPda
    ));
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

        lockAuthority,
        lockedLpAccount,

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
    "creates the canonical locked LP ATA owned by the lock-authority PDA",
    async () => {
      const [expectedLockAuthority] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("lock_authority"),
            poolPda.toBuffer(),
          ],
          program.programId
        );

      assert.isTrue(
        lockAuthority.equals(
          expectedLockAuthority
        )
      );

      const expectedLockedLpAccount =
        getAssociatedTokenAddressSync(
          lpMintPda,
          expectedLockAuthority,
          true
        );

      assert.isTrue(
        lockedLpAccount.equals(
          expectedLockedLpAccount
        )
      );

      const account =
        await getAccount(
          provider.connection,
          lockedLpAccount
        );

      assert.isTrue(
        account.mint.equals(
          lpMintPda
        )
      );

      assert.isTrue(
        account.owner.equals(
          lockAuthority
        )
      );

      assert.equal(
        account.amount,
        0n
      );

      const mint =
        await getMint(
          provider.connection,
          lpMintPda
        );

      assert.equal(
        mint.supply,
        0n
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

      // Keep this test focused on the identical-mint invariant rather
      // than allowing a future mint-authority check to fail first.
      await revokeMintAuthority(sameMint);

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

      const {
        lockAuthority: sameLockAuthority,
        lockedLpAccount: sameLockedLpAccount,
      } = deriveLockAccounts(
        samePool,
        sameLpMint
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

            lockAuthority:
              sameLockAuthority,

            lockedLpAccount:
              sameLockedLpAccount,

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

      const {
        lockAuthority: reversedLockAuthority,
        lockedLpAccount: reversedLockedLpAccount,
      } = deriveLockAccounts(
        reversedPool,
        reversedLpMint
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

            lockAuthority:
              reversedLockAuthority,

            lockedLpAccount:
              reversedLockedLpAccount,

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

            lockAuthority,
            lockedLpAccount,

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
  it(
    "rejects initialization when token 0 has a freeze authority",
    async () => {
      const {
        token0Mint: freezeToken0Mint,
        token1Mint: normalToken1Mint,
      } = await createCanonicalMintPairWithFreezeAuthority(0);

      const [freezePool] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("pool"),
            freezeToken0Mint.toBuffer(),
            normalToken1Mint.toBuffer(),
          ],
          program.programId
        );

      const freezeVault0 =
        getAssociatedTokenAddressSync(
          freezeToken0Mint,
          freezePool,
          true
        );

      const normalVault1 =
        getAssociatedTokenAddressSync(
          normalToken1Mint,
          freezePool,
          true
        );

      const [freezeLpMint] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("lp_mint"),
            freezePool.toBuffer(),
          ],
          program.programId
        );

      const {
        lockAuthority: freezeToken0LockAuthority,
        lockedLpAccount: freezeToken0LockedLpAccount,
      } = deriveLockAccounts(
        freezePool,
        freezeLpMint
      );

      await expectAnchorError(
        program.methods
          .initializePool()
          .accounts({
            initializer:
              provider.wallet.publicKey,

            token0Mint:
              freezeToken0Mint,

            token1Mint:
              normalToken1Mint,

            pool:
              freezePool,

            vault0:
              freezeVault0,

            vault1:
              normalVault1,

            lpMint:
              freezeLpMint,

            lockAuthority:
              freezeToken0LockAuthority,

            lockedLpAccount:
              freezeToken0LockedLpAccount,

            systemProgram:
              SystemProgram.programId,

            tokenProgram:
              TOKEN_PROGRAM_ID,

            associatedTokenProgram:
              ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .rpc(),
        "FreezeAuthorityNotAllowed"
      );
    }
  );

  it(
    "rejects initialization when token 1 has a freeze authority",
    async () => {
      const {
        token0Mint: normalToken0Mint,
        token1Mint: freezeToken1Mint,
      } = await createCanonicalMintPairWithFreezeAuthority(1);

      const [freezePool] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("pool"),
            normalToken0Mint.toBuffer(),
            freezeToken1Mint.toBuffer(),
          ],
          program.programId
        );

      const normalVault0 =
        getAssociatedTokenAddressSync(
          normalToken0Mint,
          freezePool,
          true
        );

      const freezeVault1 =
        getAssociatedTokenAddressSync(
          freezeToken1Mint,
          freezePool,
          true
        );

      const [freezeLpMint] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("lp_mint"),
            freezePool.toBuffer(),
          ],
          program.programId
        );

      const {
        lockAuthority: freezeToken1LockAuthority,
        lockedLpAccount: freezeToken1LockedLpAccount,
      } = deriveLockAccounts(
        freezePool,
        freezeLpMint
      );

      await expectAnchorError(
        program.methods
          .initializePool()
          .accounts({
            initializer:
              provider.wallet.publicKey,

            token0Mint:
              normalToken0Mint,

            token1Mint:
              freezeToken1Mint,

            pool:
              freezePool,

            vault0:
              normalVault0,

            vault1:
              freezeVault1,

            lpMint:
              freezeLpMint,

            lockAuthority:
              freezeToken1LockAuthority,

            lockedLpAccount:
              freezeToken1LockedLpAccount,

            systemProgram:
              SystemProgram.programId,

            tokenProgram:
              TOKEN_PROGRAM_ID,

            associatedTokenProgram:
              ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .rpc(),
        "FreezeAuthorityNotAllowed"
      );
    }
  );

  it(
  "rejects initialization when token 0 has a mint authority",
  async () => {
    const {
      token0Mint: mintAuthorityToken0,
      token1Mint: normalToken1,
    } = await createCanonicalMintPairWithMintAuthority(0);

    const [pool] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("pool"),
          mintAuthorityToken0.toBuffer(),
          normalToken1.toBuffer(),
        ],
        program.programId
      );

    const vault0 =
      getAssociatedTokenAddressSync(
        mintAuthorityToken0,
        pool,
        true
      );

    const vault1 =
      getAssociatedTokenAddressSync(
        normalToken1,
        pool,
        true
      );

    const [lpMint] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("lp_mint"),
          pool.toBuffer(),
        ],
        program.programId
      );

    const {
      lockAuthority: mintAuthorityToken0LockAuthority,
      lockedLpAccount: mintAuthorityToken0LockedLpAccount,
    } = deriveLockAccounts(
      pool,
      lpMint
    );

    await expectAnchorError(
      program.methods
        .initializePool()
        .accounts({
          initializer:
            provider.wallet.publicKey,

          token0Mint:
            mintAuthorityToken0,

          token1Mint:
            normalToken1,

          pool,
          vault0,
          vault1,
          lpMint,

          lockAuthority:
            mintAuthorityToken0LockAuthority,

          lockedLpAccount:
            mintAuthorityToken0LockedLpAccount,

          systemProgram:
            SystemProgram.programId,

          tokenProgram:
            TOKEN_PROGRAM_ID,

          associatedTokenProgram:
            ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "MintAuthorityNotAllowed"
    );
  }
);

it(
  "rejects initialization when token 1 has a mint authority",
  async () => {
    const {
      token0Mint: normalToken0,
      token1Mint: mintAuthorityToken1,
    } = await createCanonicalMintPairWithMintAuthority(1);

    const [pool] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("pool"),
          normalToken0.toBuffer(),
          mintAuthorityToken1.toBuffer(),
        ],
        program.programId
      );

    const vault0 =
      getAssociatedTokenAddressSync(
        normalToken0,
        pool,
        true
      );

    const vault1 =
      getAssociatedTokenAddressSync(
        mintAuthorityToken1,
        pool,
        true
      );

    const [lpMint] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("lp_mint"),
          pool.toBuffer(),
        ],
        program.programId
      );

    const {
      lockAuthority: mintAuthorityToken1LockAuthority,
      lockedLpAccount: mintAuthorityToken1LockedLpAccount,
    } = deriveLockAccounts(
      pool,
      lpMint
    );

    await expectAnchorError(
      program.methods
        .initializePool()
        .accounts({
          initializer:
            provider.wallet.publicKey,

          token0Mint:
            normalToken0,

          token1Mint:
            mintAuthorityToken1,

          pool,
          vault0,
          vault1,
          lpMint,

          lockAuthority:
            mintAuthorityToken1LockAuthority,

          lockedLpAccount:
            mintAuthorityToken1LockedLpAccount,

          systemProgram:
            SystemProgram.programId,

          tokenProgram:
            TOKEN_PROGRAM_ID,

          associatedTokenProgram:
            ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "MintAuthorityNotAllowed"
    );
  }
);

});