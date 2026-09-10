import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  AuthorityType,
  createAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  transfer,
} from "@solana/spl-token";

import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import { assert } from "chai";

import { ProductionAmm } from "../target/types/production_amm";


function getAnchorErrorCode(
  error: unknown
): string | undefined {
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

  const directCode =
    err?.error?.errorCode?.code;

  if (directCode) {
    return directCode;
  }

  const logs =
    err?.logs ??
    err?.transactionLogs ??
    err?.errorLogs;

  if (!Array.isArray(logs)) {
    return undefined;
  }

  const parsed =
    anchor.AnchorError.parse(logs);

  return parsed?.error.errorCode.code;
}


describe("production-amm: add_liquidity", () => {
  const provider =
    anchor.AnchorProvider.env();

  anchor.setProvider(provider);

  const program =
    anchor.workspace
      .ProductionAmm as Program<ProductionAmm>;

  const payer =
    (provider.wallet as anchor.Wallet).payer;


  let mintA: PublicKey;
  let mintB: PublicKey;

  let token0Mint: PublicKey;
  let token1Mint: PublicKey;

  let poolPda: PublicKey;

  let vault0: PublicKey;
  let vault1: PublicKey;

  let lpMintPda: PublicKey;
  let lockAuthority: PublicKey;
  let lockedLpAccount: PublicKey;

  let userToken0: PublicKey;
  let userToken1: PublicKey;

  let userLpAccount: PublicKey;


  /*
   * Initial deposit:
   *
   * sqrt(
   *   1_000_000 × 4_000_000
   * )
   *
   * = 2_000_000 LP
   */
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


  /*
   * Second deposit preserves the
   * 1 : 4 reserve ratio.
   *
   * 500_000 / 2_000_000
   *
   * LP minted:
   *
   * 500_000 × 2_000_000
   * -------------------
   *      1_000_000
   *
   * = 1_000_000 LP
   */
  const SECOND_AMOUNT_0 =
    500_000n;

  const SECOND_AMOUNT_1 =
    2_000_000n;

  const SECOND_LP =
    1_000_000n;


  before(async () => {
    /*
     * Create two external SPL token mints.
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
     * Apply protocol canonical ordering.
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
     * Derive canonical Pool PDA.
     */
    [poolPda] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("pool"),
          token0Mint.toBuffer(),
          token1Mint.toBuffer(),
        ],
        program.programId
      );


    /*
     * Canonical protocol vaults.
     */
    vault0 =
      getAssociatedTokenAddressSync(
        token0Mint,
        poolPda,
        true
      );

    vault1 =
      getAssociatedTokenAddressSync(
        token1Mint,
        poolPda,
        true
      );


    /*
     * Canonical LP mint.
     */
    [lpMintPda] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("lp_mint"),
          poolPda.toBuffer(),
        ],
        program.programId
      );

    /*
     * Deterministic lock-authority PDA and its
     * canonical LP-token ATA.
     */
    [lockAuthority] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("lock_authority"),
          poolPda.toBuffer(),
        ],
        program.programId
      );

    lockedLpAccount =
      getAssociatedTokenAddressSync(
        lpMintPda,
        lockAuthority,
        true
      );


    /*
     * Create liquidity provider's
     * token-0 and token-1 ATAs.
     */
    const token0Account =
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        token0Mint,
        payer.publicKey
      );

    const token1Account =
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        token1Mint,
        payer.publicKey
      );

    userToken0 =
      token0Account.address;

    userToken1 =
      token1Account.address;


    /*
     * Give the provider enough tokens
     * for all tests.
     */
    await mintTo(
      provider.connection,
      payer,
      token0Mint,
      userToken0,
      payer,
      20_000_000n
    );

    await mintTo(
      provider.connection,
      payer,
      token1Mint,
      userToken1,
      payer,
      80_000_000n
    );

    /*
     * The AMM's production policy will require
     * both external token mints to have no
     * remaining mint authority.
     *
     * Mint the complete test supply first, then
     * permanently revoke MintTokens authority.
     */
    await setAuthority(
      provider.connection,
      payer,
      token0Mint,
      payer,
      AuthorityType.MintTokens,
      null
    );

    await setAuthority(
      provider.connection,
      payer,
      token1Mint,
      payer,
      AuthorityType.MintTokens,
      null
    );


    /*
     * User's canonical LP ATA.
     *
     * We deliberately DO NOT create it.
     *
     * add_liquidity's init_if_needed
     * should create it automatically.
     */
    userLpAccount =
      getAssociatedTokenAddressSync(
        lpMintPda,
        payer.publicKey
      );


    /*
     * Initialize this test's pool.
     */
    await program.methods
      .initializePool()
      .accounts({
        initializer:
          payer.publicKey,

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
  });


  it(
    "adds initial liquidity, locks the minimum LP, and gives the remainder to the provider",
    async () => {
      const user0Before =
        await getAccount(
          provider.connection,
          userToken0
        );

      const user1Before =
        await getAccount(
          provider.connection,
          userToken1
        );


      await program.methods
        .addLiquidity(
          new anchor.BN(
            INITIAL_AMOUNT_0.toString()
          ),
          new anchor.BN(
            INITIAL_AMOUNT_1.toString()
          ),
          new anchor.BN("0"),
          new anchor.BN("0"),
          new anchor.BN(
            INITIAL_PROVIDER_LP.toString()
          )
        )
        .accounts({
          liquidityProvider:
            payer.publicKey,

          token0Mint,
          token1Mint,

          pool:
            poolPda,

          vault0,
          vault1,

          userToken0,
          userToken1,

          lpMint:
            lpMintPda,

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


      const vault0Account =
        await getAccount(
          provider.connection,
          vault0
        );

      const vault1Account =
        await getAccount(
          provider.connection,
          vault1
        );

      const lpMint =
        await getMint(
          provider.connection,
          lpMintPda
        );

      const userLp =
        await getAccount(
          provider.connection,
          userLpAccount
        );

      const lockedLp =
        await getAccount(
          provider.connection,
          lockedLpAccount
        );

      const user0After =
        await getAccount(
          provider.connection,
          userToken0
        );

      const user1After =
        await getAccount(
          provider.connection,
          userToken1
        );


      assert.equal(
        vault0Account.amount,
        INITIAL_AMOUNT_0
      );

      assert.equal(
        vault1Account.amount,
        INITIAL_AMOUNT_1
      );


      /*
       * Total LP supply still represents the full
       * geometric-mean liquidity value.
       */
      assert.equal(
        lpMint.supply,
        INITIAL_TOTAL_LP
      );

      /*
       * The first provider receives the total LP
       * minus the locked minimum.
       */
      assert.equal(
        userLp.amount,
        INITIAL_PROVIDER_LP
      );

      assert.equal(
        lockedLp.amount,
        MINIMUM_LIQUIDITY
      );

      assert.equal(
        userLp.amount + lockedLp.amount,
        lpMint.supply
      );


      assert.equal(
        user0Before.amount -
          user0After.amount,
        INITIAL_AMOUNT_0
      );

      assert.equal(
        user1Before.amount -
          user1After.amount,
        INITIAL_AMOUNT_1
      );
    }
  );


  it(
    "creates the liquidity provider's LP ATA automatically",
    async () => {
      const lpAccount =
        await getAccount(
          provider.connection,
          userLpAccount
        );

      assert.isTrue(
        lpAccount.mint.equals(
          lpMintPda
        )
      );

      assert.isTrue(
        lpAccount.owner.equals(
          payer.publicKey
        )
      );
    }
  );


  it(
    "adds proportional liquidity to an existing pool",
    async () => {
      const vault0Before =
        await getAccount(
          provider.connection,
          vault0
        );

      const vault1Before =
        await getAccount(
          provider.connection,
          vault1
        );

      const lpMintBefore =
        await getMint(
          provider.connection,
          lpMintPda
        );

      const userLpBefore =
        await getAccount(
          provider.connection,
          userLpAccount
        );

      const lockedLpBefore =
        await getAccount(
          provider.connection,
          lockedLpAccount
        );


      await program.methods
        .addLiquidity(
          new anchor.BN(
            SECOND_AMOUNT_0.toString()
          ),
          new anchor.BN(
            SECOND_AMOUNT_1.toString()
          ),
          new anchor.BN("0"),
          new anchor.BN("0"),
          new anchor.BN(
            SECOND_LP.toString()
          )
        )
        .accounts({
          liquidityProvider:
            payer.publicKey,

          token0Mint,
          token1Mint,

          pool:
            poolPda,

          vault0,
          vault1,

          userToken0,
          userToken1,

          lpMint:
            lpMintPda,

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


      const vault0After =
        await getAccount(
          provider.connection,
          vault0
        );

      const vault1After =
        await getAccount(
          provider.connection,
          vault1
        );

      const lpMintAfter =
        await getMint(
          provider.connection,
          lpMintPda
        );

      const userLpAfter =
        await getAccount(
          provider.connection,
          userLpAccount
        );

      const lockedLpAfter =
        await getAccount(
          provider.connection,
          lockedLpAccount
        );


      assert.equal(
        vault0After.amount -
          vault0Before.amount,
        SECOND_AMOUNT_0
      );

      assert.equal(
        vault1After.amount -
          vault1Before.amount,
        SECOND_AMOUNT_1
      );


      assert.equal(
        lpMintAfter.supply -
          lpMintBefore.supply,
        SECOND_LP
      );

      assert.equal(
        userLpAfter.amount -
          userLpBefore.amount,
        SECOND_LP
      );

      /*
       * MINIMUM_LIQUIDITY is locked only once.
       * Later deposits must not mint more tokens
       * into the locked account.
       */
      assert.equal(
        lockedLpAfter.amount,
        lockedLpBefore.amount
      );

      assert.equal(
        lockedLpAfter.amount,
        MINIMUM_LIQUIDITY
      );
    }
  );


  it(
    "uses only the optimal proportional amounts when desired amounts are imbalanced",
    async () => {
      /*
       * Current pool ratio is still 1 : 4.
       *
       * Desired maxima:
       *   token 0 = 100_000
       *   token 1 = 500_000
       *
       * Token 0 is limiting:
       *
       *   LP from token 0 = 100_000 * 3_000_000 / 1_500_000
       *                   = 200_000
       *
       *   LP from token 1 = 500_000 * 3_000_000 / 6_000_000
       *                   = 250_000
       *
       * Therefore:
       *   LP minted    = 200_000
       *   token 0 used = 100_000
       *   token 1 used = 400_000
       *
       * The extra 100_000 token 1 remains in the user's wallet.
       */
      const desired0 =
        100_000n;

      const desired1 =
        500_000n;

      const expectedUsed0 =
        100_000n;

      const expectedUsed1 =
        400_000n;

      const expectedLp =
        200_000n;


      const vault0Before =
        await getAccount(
          provider.connection,
          vault0
        );

      const vault1Before =
        await getAccount(
          provider.connection,
          vault1
        );

      const user0Before =
        await getAccount(
          provider.connection,
          userToken0
        );

      const user1Before =
        await getAccount(
          provider.connection,
          userToken1
        );

      const lpMintBefore =
        await getMint(
          provider.connection,
          lpMintPda
        );

      const userLpBefore =
        await getAccount(
          provider.connection,
          userLpAccount
        );


      await program.methods
        .addLiquidity(
          new anchor.BN(
            desired0.toString()
          ),
          new anchor.BN(
            desired1.toString()
          ),
          new anchor.BN("0"),
          new anchor.BN("0"),
          new anchor.BN(
            expectedLp.toString()
          )
        )
        .accounts({
          liquidityProvider:
            payer.publicKey,

          token0Mint,
          token1Mint,

          pool:
            poolPda,

          vault0,
          vault1,

          userToken0,
          userToken1,

          lpMint:
            lpMintPda,

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


      const vault0After =
        await getAccount(
          provider.connection,
          vault0
        );

      const vault1After =
        await getAccount(
          provider.connection,
          vault1
        );

      const user0After =
        await getAccount(
          provider.connection,
          userToken0
        );

      const user1After =
        await getAccount(
          provider.connection,
          userToken1
        );

      const lpMintAfter =
        await getMint(
          provider.connection,
          lpMintPda
        );

      const userLpAfter =
        await getAccount(
          provider.connection,
          userLpAccount
        );


      assert.equal(
        vault0After.amount -
          vault0Before.amount,
        expectedUsed0
      );

      assert.equal(
        vault1After.amount -
          vault1Before.amount,
        expectedUsed1
      );

      assert.equal(
        user0Before.amount -
          user0After.amount,
        expectedUsed0
      );

      assert.equal(
        user1Before.amount -
          user1After.amount,
        expectedUsed1
      );

      assert.equal(
        lpMintAfter.supply -
          lpMintBefore.supply,
        expectedLp
      );

      assert.equal(
        userLpAfter.amount -
          userLpBefore.amount,
        expectedLp
      );
    }
  );


  it(
    "rejects add liquidity when token-0 amount used is below the user's minimum",
    async () => {
      /*
       * Current reserve ratio remains 1 : 4.
       *
       * Desired:
       *   token 0 = 150_000
       *   token 1 = 400_000
       *
       * Token 1 is limiting, therefore the protocol
       * would use only:
       *
       *   token 0 = 100_000
       *   token 1 = 400_000
       *
       * Requiring at least 100_001 token 0 must fail.
       */
      const vault0Before =
        await getAccount(
          provider.connection,
          vault0
        );

      const vault1Before =
        await getAccount(
          provider.connection,
          vault1
        );

      const lpMintBefore =
        await getMint(
          provider.connection,
          lpMintPda
        );


      let caughtError: unknown =
        null;


      try {
        await program.methods
          .addLiquidity(
            new anchor.BN("150000"),
            new anchor.BN("400000"),
            new anchor.BN("100001"),
            new anchor.BN("0"),
            new anchor.BN("0")
          )
          .accounts({
            liquidityProvider:
              payer.publicKey,

            token0Mint,
            token1Mint,

            pool:
              poolPda,

            vault0,
            vault1,

            userToken0,
            userToken1,

            lpMint:
              lpMintPda,

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
      } catch (error) {
        caughtError = error;
      }


      assert.isNotNull(
        caughtError,
        "Expected minimum token-0 protection to reject the deposit"
      );

      assert.equal(
        getAnchorErrorCode(
          caughtError
        ),
        "MinimumAmount0NotMet"
      );


      const vault0After =
        await getAccount(
          provider.connection,
          vault0
        );

      const vault1After =
        await getAccount(
          provider.connection,
          vault1
        );

      const lpMintAfter =
        await getMint(
          provider.connection,
          lpMintPda
        );


      assert.equal(
        vault0After.amount,
        vault0Before.amount
      );

      assert.equal(
        vault1After.amount,
        vault1Before.amount
      );

      assert.equal(
        lpMintAfter.supply,
        lpMintBefore.supply
      );
    }
  );


  it(
    "rejects add liquidity when token-1 amount used is below the user's minimum",
    async () => {
      /*
       * Desired:
       *   token 0 = 100_000
       *   token 1 = 500_000
       *
       * Token 0 is limiting, therefore token 1 used
       * is only 400_000.
       *
       * Requiring at least 400_001 token 1 must fail.
       */
      const vault0Before =
        await getAccount(
          provider.connection,
          vault0
        );

      const vault1Before =
        await getAccount(
          provider.connection,
          vault1
        );

      const lpMintBefore =
        await getMint(
          provider.connection,
          lpMintPda
        );


      let caughtError: unknown =
        null;


      try {
        await program.methods
          .addLiquidity(
            new anchor.BN("100000"),
            new anchor.BN("500000"),
            new anchor.BN("0"),
            new anchor.BN("400001"),
            new anchor.BN("0")
          )
          .accounts({
            liquidityProvider:
              payer.publicKey,

            token0Mint,
            token1Mint,

            pool:
              poolPda,

            vault0,
            vault1,

            userToken0,
            userToken1,

            lpMint:
              lpMintPda,

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
      } catch (error) {
        caughtError = error;
      }


      assert.isNotNull(
        caughtError,
        "Expected minimum token-1 protection to reject the deposit"
      );

      assert.equal(
        getAnchorErrorCode(
          caughtError
        ),
        "MinimumAmount1NotMet"
      );


      const vault0After =
        await getAccount(
          provider.connection,
          vault0
        );

      const vault1After =
        await getAccount(
          provider.connection,
          vault1
        );

      const lpMintAfter =
        await getMint(
          provider.connection,
          lpMintPda
        );


      assert.equal(
        vault0After.amount,
        vault0Before.amount
      );

      assert.equal(
        vault1After.amount,
        vault1Before.amount
      );

      assert.equal(
        lpMintAfter.supply,
        lpMintBefore.supply
      );
    }
  );


  it(
    "rejects liquidity when minimum LP output is not met",
    async () => {
      /*
       * Existing pool ratio is 1 : 4.
       *
       * Deposit:
       * 100_000 + 400_000
       *
       * Expected LP output is 200_000.
       *
       * Ask for at least 200_001,
       * therefore the instruction must fail.
       */
      const vault0Before =
        await getAccount(
          provider.connection,
          vault0
        );

      const vault1Before =
        await getAccount(
          provider.connection,
          vault1
        );

      const lpMintBefore =
        await getMint(
          provider.connection,
          lpMintPda
        );


      let caughtError: unknown =
        null;


      try {
        await program.methods
          .addLiquidity(
            new anchor.BN("100000"),
            new anchor.BN("400000"),
            new anchor.BN("0"),
            new anchor.BN("0"),
            new anchor.BN("200001")
          )
          .accounts({
            liquidityProvider:
              payer.publicKey,

            token0Mint,
            token1Mint,

            pool:
              poolPda,

            vault0,
            vault1,

            userToken0,
            userToken1,

            lpMint:
              lpMintPda,

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
      } catch (error) {
        caughtError = error;
      }


      assert.isNotNull(
        caughtError,
        "Expected minimum LP protection to reject the deposit"
      );


      assert.equal(
        getAnchorErrorCode(
          caughtError
        ),
        "MinimumLpNotMet"
      );


      const vault0After =
        await getAccount(
          provider.connection,
          vault0
        );

      const vault1After =
        await getAccount(
          provider.connection,
          vault1
        );

      const lpMintAfter =
        await getMint(
          provider.connection,
          lpMintPda
        );


      assert.equal(
        vault0After.amount,
        vault0Before.amount
      );

      assert.equal(
        vault1After.amount,
        vault1Before.amount
      );

      assert.equal(
        lpMintAfter.supply,
        lpMintBefore.supply
      );
    }
  );


  it(
    "rejects zero liquidity amounts",
    async () => {
      let caughtError: unknown =
        null;


      try {
        await program.methods
          .addLiquidity(
            new anchor.BN("0"),
            new anchor.BN("400000"),
            new anchor.BN("0"),
            new anchor.BN("0"),
            new anchor.BN("0")
          )
          .accounts({
            liquidityProvider:
              payer.publicKey,

            token0Mint,
            token1Mint,

            pool:
              poolPda,

            vault0,
            vault1,

            userToken0,
            userToken1,

            lpMint:
              lpMintPda,

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
      } catch (error) {
        caughtError = error;
      }


      assert.isNotNull(
        caughtError,
        "Expected zero liquidity amount to fail"
      );


      assert.equal(
        getAnchorErrorCode(
          caughtError
        ),
        "InvalidAmount"
      );
    }
  );
  it(
    "rejects first liquidity when total initial LP does not exceed the locked minimum",
    async () => {
      /*
       * Create a fresh pool with:
       *
       * sqrt(1_000 × 1_000) = 1_000 LP
       *
       * MINIMUM_LIQUIDITY is also 1_000, so the
       * provider would receive zero redeemable LP.
       */
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

      const smallToken0Mint =
        await createMint(
          provider.connection,
          payer,
          payer.publicKey,
          null,
          6,
          token0Keypair
        );

      const smallToken1Mint =
        await createMint(
          provider.connection,
          payer,
          payer.publicKey,
          null,
          6,
          token1Keypair
        );

      const userSmallToken0 =
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          payer,
          smallToken0Mint,
          payer.publicKey
        );

      const userSmallToken1 =
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          payer,
          smallToken1Mint,
          payer.publicKey
        );

      await mintTo(
        provider.connection,
        payer,
        smallToken0Mint,
        userSmallToken0.address,
        payer,
        1_000n
      );

      await mintTo(
        provider.connection,
        payer,
        smallToken1Mint,
        userSmallToken1.address,
        payer,
        1_000n
      );

      await setAuthority(
        provider.connection,
        payer,
        smallToken0Mint,
        payer,
        AuthorityType.MintTokens,
        null
      );

      await setAuthority(
        provider.connection,
        payer,
        smallToken1Mint,
        payer,
        AuthorityType.MintTokens,
        null
      );

      const [smallPool] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("pool"),
            smallToken0Mint.toBuffer(),
            smallToken1Mint.toBuffer(),
          ],
          program.programId
        );

      const smallVault0 =
        getAssociatedTokenAddressSync(
          smallToken0Mint,
          smallPool,
          true
        );

      const smallVault1 =
        getAssociatedTokenAddressSync(
          smallToken1Mint,
          smallPool,
          true
        );

      const [smallLpMint] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("lp_mint"),
            smallPool.toBuffer(),
          ],
          program.programId
        );

      const [smallLockAuthority] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("lock_authority"),
            smallPool.toBuffer(),
          ],
          program.programId
        );

      const smallLockedLpAccount =
        getAssociatedTokenAddressSync(
          smallLpMint,
          smallLockAuthority,
          true
        );

      const smallUserLpAccount =
        getAssociatedTokenAddressSync(
          smallLpMint,
          payer.publicKey
        );

      await program.methods
        .initializePool()
        .accounts({
          initializer:
            payer.publicKey,

          token0Mint:
            smallToken0Mint,

          token1Mint:
            smallToken1Mint,

          pool:
            smallPool,

          vault0:
            smallVault0,

          vault1:
            smallVault1,

          lpMint:
            smallLpMint,

          lockAuthority:
            smallLockAuthority,

          lockedLpAccount:
            smallLockedLpAccount,

          systemProgram:
            SystemProgram.programId,

          tokenProgram:
            TOKEN_PROGRAM_ID,

          associatedTokenProgram:
            ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();

      const vault0Before =
        await getAccount(
          provider.connection,
          smallVault0
        );

      const vault1Before =
        await getAccount(
          provider.connection,
          smallVault1
        );

      const lpBefore =
        await getMint(
          provider.connection,
          smallLpMint
        );

      const lockedBefore =
        await getAccount(
          provider.connection,
          smallLockedLpAccount
        );

      let caughtError: unknown = null;

      try {
        await program.methods
          .addLiquidity(
            new anchor.BN("1000"),
            new anchor.BN("1000"),
            new anchor.BN("0"),
            new anchor.BN("0"),
            new anchor.BN("0")
          )
          .accounts({
            liquidityProvider:
              payer.publicKey,

            token0Mint:
              smallToken0Mint,

            token1Mint:
              smallToken1Mint,

            pool:
              smallPool,

            vault0:
              smallVault0,

            vault1:
              smallVault1,

            userToken0:
              userSmallToken0.address,

            userToken1:
              userSmallToken1.address,

            lpMint:
              smallLpMint,

            lockAuthority:
              smallLockAuthority,

            lockedLpAccount:
              smallLockedLpAccount,

            userLpAccount:
              smallUserLpAccount,

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
        "Expected first liquidity at the locked minimum to fail"
      );

      assert.equal(
        getAnchorErrorCode(caughtError),
        "InitialLiquidityTooSmall"
      );

      const vault0After =
        await getAccount(
          provider.connection,
          smallVault0
        );

      const vault1After =
        await getAccount(
          provider.connection,
          smallVault1
        );

      const lpAfter =
        await getMint(
          provider.connection,
          smallLpMint
        );

      const lockedAfter =
        await getAccount(
          provider.connection,
          smallLockedLpAccount
        );

      assert.equal(
        vault0After.amount,
        vault0Before.amount
      );

      assert.equal(
        vault1After.amount,
        vault1Before.amount
      );

      assert.equal(
        lpAfter.supply,
        lpBefore.supply
      );

      assert.equal(
        lockedAfter.amount,
        lockedBefore.amount
      );

      assert.equal(
        lpAfter.supply,
        0n
      );

      assert.equal(
        lockedAfter.amount,
        0n
      );
    }
  );

  it(
  "treats tokens sent to a vault before first liquidity as a donation",
  async () => {
    /*
     * We create an entirely fresh pool because
     * the main test pool already has LP supply.
     */
    const mintA = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6
    );

    const mintB = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6
    );

    let freshToken0: PublicKey;
    let freshToken1: PublicKey;

    if (
      Buffer.compare(
        mintA.toBuffer(),
        mintB.toBuffer()
      ) < 0
    ) {
      freshToken0 = mintA;
      freshToken1 = mintB;
    } else {
      freshToken0 = mintB;
      freshToken1 = mintA;
    }

    const [freshPool] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("pool"),
          freshToken0.toBuffer(),
          freshToken1.toBuffer(),
        ],
        program.programId
      );

    const freshVault0 =
      getAssociatedTokenAddressSync(
        freshToken0,
        freshPool,
        true
      );

    const freshVault1 =
      getAssociatedTokenAddressSync(
        freshToken1,
        freshPool,
        true
      );

    const [freshLpMint] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("lp_mint"),
          freshPool.toBuffer(),
        ],
        program.programId
      );

    const [freshLockAuthority] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("lock_authority"),
          freshPool.toBuffer(),
        ],
        program.programId
      );

    const freshLockedLpAccount =
      getAssociatedTokenAddressSync(
        freshLpMint,
        freshLockAuthority,
        true
      );

    const userToken0Account =
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        freshToken0,
        payer.publicKey
      );

    const userToken1Account =
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        freshToken1,
        payer.publicKey
      );

    /*
     * User needs enough tokens for:
     *
     * - donation
     * - actual first liquidity deposit
     */
    await mintTo(
      provider.connection,
      payer,
      freshToken0,
      userToken0Account.address,
      payer,
      10_000_000n
    );

    await mintTo(
      provider.connection,
      payer,
      freshToken1,
      userToken1Account.address,
      payer,
      10_000_000n
    );

    /*
     * Revoke mint authority only after all test
     * supply needed by this fresh pool has been
     * minted.
     */
    await setAuthority(
      provider.connection,
      payer,
      freshToken0,
      payer,
      AuthorityType.MintTokens,
      null
    );

    await setAuthority(
      provider.connection,
      payer,
      freshToken1,
      payer,
      AuthorityType.MintTokens,
      null
    );

    /*
     * Initialize the Pool.
     *
     * LP supply is still zero after this.
     */
    await program.methods
      .initializePool()
      .accounts({
        initializer:
          payer.publicKey,

        token0Mint:
          freshToken0,

        token1Mint:
          freshToken1,

        pool:
          freshPool,

        vault0:
          freshVault0,

        vault1:
          freshVault1,

        lpMint:
          freshLpMint,

        lockAuthority:
          freshLockAuthority,

        lockedLpAccount:
          freshLockedLpAccount,

        systemProgram:
          SystemProgram.programId,

        tokenProgram:
          TOKEN_PROGRAM_ID,

        associatedTokenProgram:
          ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    /*
     * Someone directly sends token 0 into the
     * protocol vault BEFORE any LP exists.
     *
     * This models a donation.
     */
    const donation =
      100_000n;

    await transfer(
      provider.connection,
      payer,
      userToken0Account.address,
      freshVault0,
      payer,
      donation
    );

    /*
     * Confirm the lifecycle state:
     *
     * vault contains tokens
     * BUT
     * LP supply is zero.
     */
    const lpBefore =
      await getMint(
        provider.connection,
        freshLpMint
      );

    const vault0Before =
      await getAccount(
        provider.connection,
        freshVault0
      );

    const lockedBefore =
      await getAccount(
        provider.connection,
        freshLockedLpAccount
      );

    assert.equal(
      lpBefore.supply,
      0n
    );

    assert.equal(
      lockedBefore.amount,
      0n
    );

    assert.equal(
      vault0Before.amount,
      donation
    );

    /*
     * Actual initial LP contribution:
     *
     * amount_0 = 1,000,000
     * amount_1 = 4,000,000
     *
     * sqrt(
     *   1,000,000 × 4,000,000
     * )
     *
     * = 2,000,000 LP
     *
     * Importantly:
     *
     * donation is NOT included in this
     * LP calculation.
     */
    const amount0 =
      1_000_000n;

    const amount1 =
      4_000_000n;

    const expectedTotalLp =
      2_000_000n;

    const expectedProviderLp =
      expectedTotalLp - MINIMUM_LIQUIDITY;

    const userLpAccount =
      getAssociatedTokenAddressSync(
        freshLpMint,
        payer.publicKey
      );

    await program.methods
      .addLiquidity(
        new anchor.BN(
          amount0.toString()
        ),
        new anchor.BN(
          amount1.toString()
        ),
        new anchor.BN("0"),
        new anchor.BN("0"),
        new anchor.BN(
          expectedProviderLp.toString()
        )
      )
      .accounts({
        liquidityProvider:
          payer.publicKey,

        token0Mint:
          freshToken0,

        token1Mint:
          freshToken1,

        pool:
          freshPool,

        vault0:
          freshVault0,

        vault1:
          freshVault1,

        userToken0:
          userToken0Account.address,

        userToken1:
          userToken1Account.address,

        lpMint:
          freshLpMint,

        lockAuthority:
          freshLockAuthority,

        lockedLpAccount:
          freshLockedLpAccount,

        userLpAccount,

        systemProgram:
          SystemProgram.programId,

        tokenProgram:
          TOKEN_PROGRAM_ID,

        associatedTokenProgram:
          ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    const vault0After =
      await getAccount(
        provider.connection,
        freshVault0
      );

    const vault1After =
      await getAccount(
        provider.connection,
        freshVault1
      );

    const lpAfter =
      await getMint(
        provider.connection,
        freshLpMint
      );

    const userLpAfter =
      await getAccount(
        provider.connection,
        userLpAccount
      );

    const lockedLpAfter =
      await getAccount(
        provider.connection,
        freshLockedLpAccount
      );

    /*
     * Donation remains in the vault.
     */
    assert.equal(
      vault0After.amount,
      donation + amount0
    );

    assert.equal(
      vault1After.amount,
      amount1
    );

    /*
     * But LP issuance depends only on
     * the provider's actual deposit.
     */
    assert.equal(
      lpAfter.supply,
      expectedTotalLp
    );

    assert.equal(
      userLpAfter.amount,
      expectedProviderLp
    );

    assert.equal(
      lockedLpAfter.amount,
      MINIMUM_LIQUIDITY
    );

    assert.equal(
      userLpAfter.amount + lockedLpAfter.amount,
      lpAfter.supply
    );
  }
);

it(
  "rejects liquidity when the provider has insufficient token-0 balance",
  async () => {
    /*
     * Create a valid Token0 account:
     *
     * mint      = token0Mint
     * authority = payer
     * balance   = 0
     *
     * It satisfies our account constraints,
     * but does not contain enough tokens.
     */
    const emptyToken0Keypair =
      Keypair.generate();

    const emptyToken0Account =
      await createAccount(
      provider.connection,
      payer,
      token0Mint,
      payer.publicKey,
      emptyToken0Keypair
    );

    /*
     * Use a valid proportional deposit.
     *
     * Current pool ratio is still 1 : 4,
     * so we deliberately avoid triggering
     * InvalidLiquidityRatio first.
     */
    const amount0 = 100_000n;
    const amount1 = 400_000n;

    const vault0Before =
      await getAccount(
        provider.connection,
        vault0
      );

    const vault1Before =
      await getAccount(
        provider.connection,
        vault1
      );

    const lpMintBefore =
      await getMint(
        provider.connection,
        lpMintPda
      );

    let caughtError: unknown = null;

    try {
      await program.methods
        .addLiquidity(
          new anchor.BN(
            amount0.toString()
          ),
          new anchor.BN(
            amount1.toString()
          ),
          new anchor.BN("0"),
          new anchor.BN("0"),
          new anchor.BN("0")
        )
        .accounts({
          liquidityProvider:
            payer.publicKey,

          token0Mint,
          token1Mint,

          pool:
            poolPda,

          vault0,
          vault1,

          /*
           * Empty but otherwise valid Token0
           * account controlled by the provider.
           */
          userToken0:
            emptyToken0Account,

          /*
           * Normal funded Token1 account.
           */
          userToken1,

          lpMint:
            lpMintPda,

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
    } catch (error) {
      caughtError = error;
    }

    assert.isNotNull(
      caughtError,
      "Expected insufficient token-0 balance to fail"
    );

    assert.equal(
      getAnchorErrorCode(caughtError),
      "InsufficientToken0Balance"
    );

    /*
     * Financial state must remain unchanged.
     */
    const vault0After =
      await getAccount(
        provider.connection,
        vault0
      );

    const vault1After =
      await getAccount(
        provider.connection,
        vault1
      );

    const lpMintAfter =
      await getMint(
        provider.connection,
        lpMintPda
      );

    assert.equal(
      vault0After.amount,
      vault0Before.amount
    );

    assert.equal(
      vault1After.amount,
      vault1Before.amount
    );

    assert.equal(
      lpMintAfter.supply,
      lpMintBefore.supply
    );
  }
);

it(
  "rejects liquidity when the provider has insufficient token-1 balance",
  async () => {
    /*
     * Create a valid, independent Token1 account:
     *
     * mint      = token1Mint
     * authority = payer
     * balance   = 0
     *
     * Supplying an explicit Keypair guarantees this is a
     * regular token account rather than the provider's ATA.
     */
    const emptyToken1Keypair =
      Keypair.generate();

    const emptyToken1Account =
      await createAccount(
        provider.connection,
        payer,
        token1Mint,
        payer.publicKey,
        emptyToken1Keypair
      );

    /*
     * Keep the deposit proportional to the current 1 : 4
     * reserve ratio so the balance check is the condition
     * that rejects the transaction.
     */
    const amount0 = 100_000n;
    const amount1 = 400_000n;

    const vault0Before =
      await getAccount(
        provider.connection,
        vault0
      );

    const vault1Before =
      await getAccount(
        provider.connection,
        vault1
      );

    const lpMintBefore =
      await getMint(
        provider.connection,
        lpMintPda
      );

    let caughtError: unknown = null;

    try {
      await program.methods
        .addLiquidity(
          new anchor.BN(
            amount0.toString()
          ),
          new anchor.BN(
            amount1.toString()
          ),
          new anchor.BN("0"),
          new anchor.BN("0"),
          new anchor.BN("0")
        )
        .accounts({
          liquidityProvider:
            payer.publicKey,

          token0Mint,
          token1Mint,

          pool:
            poolPda,

          vault0,
          vault1,

          /*
           * Normal funded Token0 account.
           */
          userToken0,

          /*
           * Empty but otherwise valid Token1 account
           * controlled by the provider.
           */
          userToken1:
            emptyToken1Account,

          lpMint:
            lpMintPda,

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
    } catch (error) {
      caughtError = error;
    }

    assert.isNotNull(
      caughtError,
      "Expected insufficient token-1 balance to fail"
    );

    assert.equal(
      getAnchorErrorCode(caughtError),
      "InsufficientToken1Balance"
    );

    /*
     * Both user-balance checks occur before either transfer
     * CPI, so vault reserves and LP supply must be unchanged.
     */
    const vault0After =
      await getAccount(
        provider.connection,
        vault0
      );

    const vault1After =
      await getAccount(
        provider.connection,
        vault1
      );

    const lpMintAfter =
      await getMint(
        provider.connection,
        lpMintPda
      );

    assert.equal(
      vault0After.amount,
      vault0Before.amount
    );

    assert.equal(
      vault1After.amount,
      vault1Before.amount
    );

    assert.equal(
      lpMintAfter.supply,
      lpMintBefore.supply
    );
  }
);



it(
  "accepts later liquidity after extra LP is donated to the locked account",
  async () => {
    /*
     * At this point the main pool has already received:
     *
     * initial liquidity:
     *   reserves = 1,000,000 / 4,000,000
     *   LP supply = 2,000,000
     *
     * second proportional deposit:
     *   reserves = 1,500,000 / 6,000,000
     *   LP supply = 3,000,000
     *
     * The protocol originally locked 1,000 LP.
     */
    const lockedBeforeDonation =
      await getAccount(
        provider.connection,
        lockedLpAccount
      );

    const userLpBeforeDonation =
      await getAccount(
        provider.connection,
        userLpAccount
      );

    const lpMintBeforeDonation =
      await getMint(
        provider.connection,
        lpMintPda
      );

    assert.equal(
      lockedBeforeDonation.amount,
      MINIMUM_LIQUIDITY
    );

    /*
     * Anyone who owns LP tokens can transfer existing LP
     * into the locked account. This must NOT increase supply.
     */
    const donatedLp = 1n;

    await transfer(
      provider.connection,
      payer,
      userLpAccount,
      lockedLpAccount,
      payer,
      donatedLp
    );

    const lockedAfterDonation =
      await getAccount(
        provider.connection,
        lockedLpAccount
      );

    const userLpAfterDonation =
      await getAccount(
        provider.connection,
        userLpAccount
      );

    const lpMintAfterDonation =
      await getMint(
        provider.connection,
        lpMintPda
      );

    assert.equal(
      lockedAfterDonation.amount,
      MINIMUM_LIQUIDITY + donatedLp
    );

    assert.equal(
      userLpBeforeDonation.amount -
        userLpAfterDonation.amount,
      donatedLp
    );

    assert.equal(
      lpMintAfterDonation.supply,
      lpMintBeforeDonation.supply
    );

    /*
     * Because add_liquidity requires:
     *
     * locked_lp_account.amount >= MINIMUM_LIQUIDITY
     *
     * rather than exact equality, the extra donated LP must
     * not DoS future liquidity additions.
     *
     * Current pool ratio is still 1 : 4.
     */
    const amount0 = 100_000n;
    const amount1 = 400_000n;

    const vault0Before =
      await getAccount(
        provider.connection,
        vault0
      );

    const vault1Before =
      await getAccount(
        provider.connection,
        vault1
      );

    const lpSupplyBeforeAdd =
      lpMintAfterDonation.supply;

    const expectedProviderLp =
      (amount0 * lpSupplyBeforeAdd) /
      vault0Before.amount;

    await program.methods
      .addLiquidity(
        new anchor.BN(
          amount0.toString()
        ),
        new anchor.BN(
          amount1.toString()
        ),
        new anchor.BN("0"),
        new anchor.BN("0"),
        new anchor.BN(
          expectedProviderLp.toString()
        )
      )
      .accounts({
        liquidityProvider:
          payer.publicKey,

        token0Mint,
        token1Mint,

        pool:
          poolPda,

        vault0,
        vault1,

        userToken0,
        userToken1,

        lpMint:
          lpMintPda,

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

    const lockedAfterAdd =
      await getAccount(
        provider.connection,
        lockedLpAccount
      );

    const userLpAfterAdd =
      await getAccount(
        provider.connection,
        userLpAccount
      );

    const lpMintAfterAdd =
      await getMint(
        provider.connection,
        lpMintPda
      );

    const vault0After =
      await getAccount(
        provider.connection,
        vault0
      );

    const vault1After =
      await getAccount(
        provider.connection,
        vault1
      );

    /*
     * No new LP is minted to the lock account on later adds.
     * The extra donated 1 LP simply remains there.
     */
    assert.equal(
      lockedAfterAdd.amount,
      MINIMUM_LIQUIDITY + donatedLp
    );

    assert.equal(
      userLpAfterAdd.amount -
        userLpAfterDonation.amount,
      expectedProviderLp
    );

    assert.equal(
      lpMintAfterAdd.supply -
        lpSupplyBeforeAdd,
      expectedProviderLp
    );

    assert.equal(
      vault0After.amount -
        vault0Before.amount,
      amount0
    );

    assert.equal(
      vault1After.amount -
        vault1Before.amount,
      amount1
    );
  }
);

});
