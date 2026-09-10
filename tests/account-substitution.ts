import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  AuthorityType,
  ACCOUNT_SIZE,
  createInitializeAccountInstruction,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
} from "@solana/spl-token";

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import { expect } from "chai";

import { ProductionAmm } from "../target/types/production_amm";


describe("production-amm: account substitution", () => {
  const provider =
    anchor.AnchorProvider.env();

  anchor.setProvider(provider);

  const program =
    anchor.workspace
      .ProductionAmm as Program<ProductionAmm>;

  const connection =
    provider.connection;

  const payer =
    (provider.wallet as anchor.Wallet).payer;

  const trader =
    payer.publicKey;


  let token0Mint: PublicKey;
  let token1Mint: PublicKey;

  let pool: PublicKey;
  let vault0: PublicKey;
  let vault1: PublicKey;

  let lpMint: PublicKey;
  let lockAuthority: PublicKey;
  let lockedLpAccount: PublicKey;

  let userToken0: PublicKey;
  let userToken1: PublicKey;
  let userLpAccount: PublicKey;

  /*
   * These are valid SPL token accounts with:
   *
   *   correct mint
   *   correct Pool PDA authority
   *
   * but they are NOT the protocol's canonical ATAs.
   *
   * This makes them useful substitution-attack accounts.
   */
  let fakeVault0: PublicKey;
  let fakeVault1: PublicKey;

  /*
   * Attacker-controlled fake LP mint + LP token account.
   *
   * If remove_liquidity failed to bind lp_mint to the
   * canonical PDA, fake LP could potentially be burned
   * in exchange for real pool reserves.
   */
  let fakeLpMint: PublicKey;
  let fakeUserLpAccount: PublicKey;

  /*
   * A second legitimate Pool account used to test that a
   * pool from one token pair cannot be mixed with the
   * accounts of another token pair.
   */
  let secondPool: PublicKey;


  const INITIAL_AMOUNT_0 =
    1_000_000n;

  const INITIAL_AMOUNT_1 =
    4_000_000n;

  const MINIMUM_LIQUIDITY =
    1_000n;

  const INITIAL_TOTAL_LP =
    2_000_000n;

  const INITIAL_PROVIDER_LP =
    INITIAL_TOTAL_LP - MINIMUM_LIQUIDITY;


  const token0ToToken1 = {
    token0ToToken1: {},
  } as any;


  async function expectRejected(
    promise: Promise<unknown>,
  ): Promise<void> {
    let caughtError: unknown =
      undefined;

    try {
      await promise;
    } catch (error) {
      caughtError = error;
    }

    expect(
      caughtError,
      "Expected account-substitution transaction to be rejected",
    ).to.not.equal(undefined);
  }


  async function createNonCanonicalTokenAccount(
    mint: PublicKey,
    owner: PublicKey,
  ): Promise<PublicKey> {
    /*
     * We intentionally create a normal SPL token account
     * at a fresh random address.
     *
     * We cannot use an ATA helper here because:
     *
     *   1. Pool is a PDA (off curve), and
     *   2. for this attack test we specifically need a
     *      NON-canonical token-account address.
     *
     * The token account itself is created as a normal
     * SystemProgram account owned by the SPL Token Program,
     * then initialized with:
     *
     *   mint  = the real pool token mint
     *   owner = the real Pool PDA
     *
     * This proves that mint + token authority alone are not
     * sufficient to establish protocol-vault identity.
     */

    const tokenAccount =
      Keypair.generate();

    const lamports =
      await connection
        .getMinimumBalanceForRentExemption(
          ACCOUNT_SIZE,
        );

    const transaction =
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey:
            payer.publicKey,

          newAccountPubkey:
            tokenAccount.publicKey,

          lamports,

          space:
            ACCOUNT_SIZE,

          programId:
            TOKEN_PROGRAM_ID,
        }),

        createInitializeAccountInstruction(
          tokenAccount.publicKey,
          mint,
          owner,
          TOKEN_PROGRAM_ID,
        ),
      );

    await provider.sendAndConfirm(
      transaction,
      [tokenAccount],
    );

    return tokenAccount.publicKey;
  }


  async function canonicalSnapshot() {
    const [
      vault0Account,
      vault1Account,
      user0Account,
      user1Account,
      lpMintAccount,
      userLp,
      lockedLp,
    ] = await Promise.all([
      getAccount(
        connection,
        vault0,
      ),
      getAccount(
        connection,
        vault1,
      ),
      getAccount(
        connection,
        userToken0,
      ),
      getAccount(
        connection,
        userToken1,
      ),
      getMint(
        connection,
        lpMint,
      ),
      getAccount(
        connection,
        userLpAccount,
      ),
      getAccount(
        connection,
        lockedLpAccount,
      ),
    ]);

    return {
      vault0:
        vault0Account.amount,
      vault1:
        vault1Account.amount,
      user0:
        user0Account.amount,
      user1:
        user1Account.amount,
      lpSupply:
        lpMintAccount.supply,
      userLp:
        userLp.amount,
      lockedLp:
        lockedLp.amount,
    };
  }


  async function expectCanonicalStateUnchanged(
    before:
      Awaited<ReturnType<typeof canonicalSnapshot>>,
  ): Promise<void> {
    const after =
      await canonicalSnapshot();

    expect(after.vault0)
      .to.equal(before.vault0);

    expect(after.vault1)
      .to.equal(before.vault1);

    expect(after.user0)
      .to.equal(before.user0);

    expect(after.user1)
      .to.equal(before.user1);

    expect(after.lpSupply)
      .to.equal(before.lpSupply);

    expect(after.userLp)
      .to.equal(before.userLp);

    expect(after.lockedLp)
      .to.equal(before.lockedLp);
  }


  before(async () => {
    /*
     * -----------------------------------------------------
     * Main token pair
     * -----------------------------------------------------
     */

    const mintA =
      await createMint(
        connection,
        payer,
        payer.publicKey,
        null,
        6,
      );

    const mintB =
      await createMint(
        connection,
        payer,
        payer.publicKey,
        null,
        6,
      );


    if (
      Buffer.compare(
        mintA.toBuffer(),
        mintB.toBuffer(),
      ) < 0
    ) {
      token0Mint = mintA;
      token1Mint = mintB;
    } else {
      token0Mint = mintB;
      token1Mint = mintA;
    }


    [pool] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("pool"),
          token0Mint.toBuffer(),
          token1Mint.toBuffer(),
        ],
        program.programId,
      );


    vault0 =
      getAssociatedTokenAddressSync(
        token0Mint,
        pool,
        true,
      );

    vault1 =
      getAssociatedTokenAddressSync(
        token1Mint,
        pool,
        true,
      );


    [lpMint] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("lp_mint"),
          pool.toBuffer(),
        ],
        program.programId,
      );


    [lockAuthority] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("lock_authority"),
          pool.toBuffer(),
        ],
        program.programId,
      );


    lockedLpAccount =
      getAssociatedTokenAddressSync(
        lpMint,
        lockAuthority,
        true,
      );


    /*
     * Provider's canonical source token accounts.
     */
    const token0Account =
      await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        token0Mint,
        trader,
      );

    const token1Account =
      await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        token1Mint,
        trader,
      );


    userToken0 =
      token0Account.address;

    userToken1 =
      token1Account.address;


    userLpAccount =
      getAssociatedTokenAddressSync(
        lpMint,
        trader,
      );


    /*
     * -----------------------------------------------------
     * Fake protocol vaults
     * -----------------------------------------------------
     *
     * SPL considers these perfectly valid token accounts.
     *
     * They even have:
     *
     *   mint      = correct pool token mint
     *   authority = Pool PDA
     *
     * The only thing that makes them invalid for OUR AMM
     * is that they are not the canonical Pool ATAs.
     */

    fakeVault0 =
      await createNonCanonicalTokenAccount(
        token0Mint,
        pool,
      );

    fakeVault1 =
      await createNonCanonicalTokenAccount(
        token1Mint,
        pool,
      );


    /*
     * Fund the user and the fake vaults BEFORE revoking the
     * external mints' MintTokens authorities.
     *
     * The fake balances are deliberately large enough that
     * the instruction could perform meaningful math if the
     * canonical-vault constraint were missing.
     */

    await mintTo(
      connection,
      payer,
      token0Mint,
      userToken0,
      payer,
      10_000_000n,
    );

    await mintTo(
      connection,
      payer,
      token1Mint,
      userToken1,
      payer,
      40_000_000n,
    );

    await mintTo(
      connection,
      payer,
      token0Mint,
      fakeVault0,
      payer,
      5_000_000n,
    );

    await mintTo(
      connection,
      payer,
      token1Mint,
      fakeVault1,
      payer,
      20_000_000n,
    );


    /*
     * External pool mints must be immutable under our v1
     * policy before initialize_pool is allowed.
     */

    await setAuthority(
      connection,
      payer,
      token0Mint,
      payer,
      AuthorityType.MintTokens,
      null,
    );

    await setAuthority(
      connection,
      payer,
      token1Mint,
      payer,
      AuthorityType.MintTokens,
      null,
    );


    /*
     * Initialize the real canonical pool.
     */

    await program.methods
      .initializePool()
      .accounts({
        initializer:
          trader,

        token0Mint,
        token1Mint,

        pool,

        vault0,
        vault1,

        lpMint,

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


    /*
     * Seed canonical liquidity.
     */

    await program.methods
      .addLiquidity(
        new anchor.BN(
          INITIAL_AMOUNT_0.toString(),
        ),
        new anchor.BN(
          INITIAL_AMOUNT_1.toString(),
        ),
        new anchor.BN(
          INITIAL_PROVIDER_LP.toString(),
        ),
      )
      .accounts({
        liquidityProvider:
          trader,

        token0Mint,
        token1Mint,

        pool,

        vault0,
        vault1,

        userToken0,
        userToken1,

        lpMint,

        lockAuthority,
        lockedLpAccount,

        userLpAccount,

        systemProgram:
          SystemProgram.programId,

        tokenProgram:
          TOKEN_PROGRAM_ID,

        associatedTokenProgram:
          ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();


    /*
     * -----------------------------------------------------
     * Fake attacker LP mint
     * -----------------------------------------------------
     *
     * This mint is controlled by the test wallet, not by the
     * AMM. The attacker can therefore manufacture arbitrary
     * fake LP.
     */

    fakeLpMint =
      await createMint(
        connection,
        payer,
        payer.publicKey,
        null,
        9,
      );


    const fakeLpAccount =
      await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        fakeLpMint,
        trader,
      );


    fakeUserLpAccount =
      fakeLpAccount.address;


    await mintTo(
      connection,
      payer,
      fakeLpMint,
      fakeUserLpAccount,
      payer,
      10_000_000n,
    );


    /*
     * -----------------------------------------------------
     * Second legitimate pool
     * -----------------------------------------------------
     */

    const secondMintA =
      await createMint(
        connection,
        payer,
        payer.publicKey,
        null,
        6,
      );

    const secondMintB =
      await createMint(
        connection,
        payer,
        payer.publicKey,
        null,
        6,
      );


    let secondToken0Mint: PublicKey;
    let secondToken1Mint: PublicKey;


    if (
      Buffer.compare(
        secondMintA.toBuffer(),
        secondMintB.toBuffer(),
      ) < 0
    ) {
      secondToken0Mint =
        secondMintA;

      secondToken1Mint =
        secondMintB;
    } else {
      secondToken0Mint =
        secondMintB;

      secondToken1Mint =
        secondMintA;
    }


    [secondPool] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("pool"),
          secondToken0Mint.toBuffer(),
          secondToken1Mint.toBuffer(),
        ],
        program.programId,
      );


    const secondVault0 =
      getAssociatedTokenAddressSync(
        secondToken0Mint,
        secondPool,
        true,
      );

    const secondVault1 =
      getAssociatedTokenAddressSync(
        secondToken1Mint,
        secondPool,
        true,
      );


    const [secondLpMint] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("lp_mint"),
          secondPool.toBuffer(),
        ],
        program.programId,
      );


    const [secondLockAuthority] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("lock_authority"),
          secondPool.toBuffer(),
        ],
        program.programId,
      );


    const secondLockedLpAccount =
      getAssociatedTokenAddressSync(
        secondLpMint,
        secondLockAuthority,
        true,
      );


    await setAuthority(
      connection,
      payer,
      secondToken0Mint,
      payer,
      AuthorityType.MintTokens,
      null,
    );

    await setAuthority(
      connection,
      payer,
      secondToken1Mint,
      payer,
      AuthorityType.MintTokens,
      null,
    );


    await program.methods
      .initializePool()
      .accounts({
        initializer:
          trader,

        token0Mint:
          secondToken0Mint,

        token1Mint:
          secondToken1Mint,

        pool:
          secondPool,

        vault0:
          secondVault0,

        vault1:
          secondVault1,

        lpMint:
          secondLpMint,

        lockAuthority:
          secondLockAuthority,

        lockedLpAccount:
          secondLockedLpAccount,

        systemProgram:
          SystemProgram.programId,

        tokenProgram:
          TOKEN_PROGRAM_ID,

        associatedTokenProgram:
          ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
  });


  it(
    "rejects add_liquidity with a non-canonical token-0 vault even when mint and authority are correct",
    async () => {
      const before =
        await canonicalSnapshot();

      const fakeBefore =
        await getAccount(
          connection,
          fakeVault0,
        );


      /*
       * fake vault ratio:
       *
       * fake token0 = 5,000,000
       * real token1 = 4,000,000
       *
       * 500,000 : 400,000 is proportional.
       *
       * So if the canonical-address constraint vanished,
       * this call could get through the liquidity math.
       */
      await expectRejected(
        program.methods
          .addLiquidity(
            new anchor.BN("500000"),
            new anchor.BN("400000"),
            new anchor.BN("0"),
          )
          .accounts({
            liquidityProvider:
              trader,

            token0Mint,
            token1Mint,

            pool,

            vault0:
              fakeVault0,

            vault1,

            userToken0,
            userToken1,

            lpMint,

            lockAuthority,
            lockedLpAccount,

            userLpAccount,

            systemProgram:
              SystemProgram.programId,

            tokenProgram:
              TOKEN_PROGRAM_ID,

            associatedTokenProgram:
              ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .rpc(),
      );


      await expectCanonicalStateUnchanged(
        before,
      );


      const fakeAfter =
        await getAccount(
          connection,
          fakeVault0,
        );

      expect(fakeAfter.amount)
        .to.equal(fakeBefore.amount);
    },
  );


  it(
    "rejects swap with a non-canonical token-1 vault even when mint and authority are correct",
    async () => {
      const before =
        await canonicalSnapshot();

      const fakeBefore =
        await getAccount(
          connection,
          fakeVault1,
        );


      await expectRejected(
        program.methods
          .swap(
            token0ToToken1,
            new anchor.BN("100000"),
            new anchor.BN("0"),
          )
          .accounts({
            trader,

            token0Mint,
            token1Mint,

            pool,

            vault0,

            vault1:
              fakeVault1,

            userToken0,
            userToken1,

            tokenProgram:
              TOKEN_PROGRAM_ID,
          })
          .rpc(),
      );


      await expectCanonicalStateUnchanged(
        before,
      );


      const fakeAfter =
        await getAccount(
          connection,
          fakeVault1,
        );

      expect(fakeAfter.amount)
        .to.equal(fakeBefore.amount);
    },
  );


  it(
    "rejects remove_liquidity using attacker-created fake LP tokens",
    async () => {
      const before =
        await canonicalSnapshot();

      const fakeLpBefore =
        await getAccount(
          connection,
          fakeUserLpAccount,
        );

      const fakeMintBefore =
        await getMint(
          connection,
          fakeLpMint,
        );


      /*
       * This is the dangerous substitution pattern:
       *
       * attacker manufactures fake LP
       *       ↓
       * passes fake LP mint/account
       *       ↓
       * tries to withdraw REAL canonical reserves
       *
       * The LP mint's protocol identity constraints must
       * reject the transaction before any burn/withdrawal.
       */

      await expectRejected(
        program.methods
          .removeLiquidity(
            new anchor.BN("100000"),
            new anchor.BN("0"),
            new anchor.BN("0"),
          )
          .accounts({
            liquidityProvider:
              trader,

            token0Mint,
            token1Mint,

            pool,

            vault0,
            vault1,

            userToken0,
            userToken1,

            lpMint:
              fakeLpMint,

            userLpAccount:
              fakeUserLpAccount,

            tokenProgram:
              TOKEN_PROGRAM_ID,
          })
          .rpc(),
      );


      await expectCanonicalStateUnchanged(
        before,
      );


      const fakeLpAfter =
        await getAccount(
          connection,
          fakeUserLpAccount,
        );

      const fakeMintAfter =
        await getMint(
          connection,
          fakeLpMint,
        );


      expect(fakeLpAfter.amount)
        .to.equal(fakeLpBefore.amount);

      expect(fakeMintAfter.supply)
        .to.equal(fakeMintBefore.supply);
    },
  );


  it(
    "rejects mixing a legitimate pool PDA from another token pair with this pool's accounts",
    async () => {
      const before =
        await canonicalSnapshot();


      /*
       * secondPool is a real initialized Pool account,
       * not a random address.
       *
       * But it belongs to a completely different token pair.
       * Passing it beside this pair's mints/vaults must fail
       * the protocol relationship constraints.
       */

      await expectRejected(
        program.methods
          .swap(
            token0ToToken1,
            new anchor.BN("100000"),
            new anchor.BN("0"),
          )
          .accounts({
            trader,

            token0Mint,
            token1Mint,

            pool:
              secondPool,

            vault0,
            vault1,

            userToken0,
            userToken1,

            tokenProgram:
              TOKEN_PROGRAM_ID,
          })
          .rpc(),
      );


      await expectCanonicalStateUnchanged(
        before,
      );
    },
  );
});
