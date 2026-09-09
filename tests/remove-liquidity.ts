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
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
} from "@solana/spl-token";

import {
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


describe("production-amm: remove_liquidity", () => {
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
   * Initial pool:
   *
   * token 0 = 1,000,000
   * token 1 = 4,000,000
   *
   * initial LP:
   *
   * sqrt(
   *   1,000,000 × 4,000,000
   * )
   *
   * = 2,000,000
   */
  const INITIAL_AMOUNT_0 =
    1_000_000n;

  const INITIAL_AMOUNT_1 =
    4_000_000n;

  const INITIAL_LP =
    2_000_000n;

  const MINIMUM_LIQUIDITY =
    1_000n;

  const INITIAL_PROVIDER_LP =
    INITIAL_LP - MINIMUM_LIQUIDITY;


  /*
   * We initially give the user more
   * tokens than needed to seed the pool.
   */
  const USER_INITIAL_TOKEN_0 =
    10_000_000n;

  const USER_INITIAL_TOKEN_1 =
    40_000_000n;


  before(async () => {
    /*
     * Create two external SPL mints.
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
      6
    );


    /*
     * Canonical ordering required
     * by our AMM.
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
     * Pool PDA.
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
     * Canonical LP mint PDA.
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
     * Permanent-liquidity lock authority and its
     * canonical LP token account.
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
     * User token accounts.
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
     * Give provider tokens.
     */
    await mintTo(
      provider.connection,
      payer,
      token0Mint,
      userToken0,
      payer,
      USER_INITIAL_TOKEN_0
    );

    await mintTo(
      provider.connection,
      payer,
      token1Mint,
      userToken1,
      payer,
      USER_INITIAL_TOKEN_1
    );

    /*
     * Mint all test supply first, then permanently
     * revoke the external mints' MintTokens
     * authorities before pool initialization.
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
     * LP ATA address.
     *
     * add_liquidity will create this
     * through init_if_needed.
     */
    userLpAccount =
      getAssociatedTokenAddressSync(
        lpMintPda,
        payer.publicKey
      );


    /*
     * Initialize fresh pool.
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


    /*
     * Seed initial liquidity.
     */
    await program.methods
      .addLiquidity(
        new anchor.BN(
          INITIAL_AMOUNT_0.toString()
        ),
        new anchor.BN(
          INITIAL_AMOUNT_1.toString()
        ),
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
  });


  it(
    "starts with the expected seeded liquidity state",
    async () => {
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


      assert.equal(
        vault0Account.amount,
        INITIAL_AMOUNT_0
      );

      assert.equal(
        vault1Account.amount,
        INITIAL_AMOUNT_1
      );

      assert.equal(
        lpMint.supply,
        INITIAL_LP
      );

      assert.equal(
        userLp.amount,
        INITIAL_PROVIDER_LP
      );

      assert.equal(
        lockedLp.amount,
        MINIMUM_LIQUIDITY
      );
    }
  );


  it(
    "removes partial liquidity proportionally",
    async () => {
      /*
       * Burn:
       *
       * 500,000 / 2,000,000
       * = 25% of LP supply
       *
       * Therefore:
       *
       * token 0 out:
       * 1,000,000 × 25%
       * = 250,000
       *
       * token 1 out:
       * 4,000,000 × 25%
       * = 1,000,000
       */
      const lpToBurn =
        500_000n;

      const expectedAmount0 =
        250_000n;

      const expectedAmount1 =
        1_000_000n;


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

      const userToken0Before =
        await getAccount(
          provider.connection,
          userToken0
        );

      const userToken1Before =
        await getAccount(
          provider.connection,
          userToken1
        );


      await program.methods
        .removeLiquidity(
          new anchor.BN(
            lpToBurn.toString()
          ),
          new anchor.BN(
            expectedAmount0.toString()
          ),
          new anchor.BN(
            expectedAmount1.toString()
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

          userLpAccount,

          tokenProgram:
            TOKEN_PROGRAM_ID,
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

      const userToken0After =
        await getAccount(
          provider.connection,
          userToken0
        );

      const userToken1After =
        await getAccount(
          provider.connection,
          userToken1
        );


      /*
       * Vault reserves decrease.
       */
      assert.equal(
        vault0Before.amount -
          vault0After.amount,
        expectedAmount0
      );

      assert.equal(
        vault1Before.amount -
          vault1After.amount,
        expectedAmount1
      );


      /*
       * User receives both assets.
       */
      assert.equal(
        userToken0After.amount -
          userToken0Before.amount,
        expectedAmount0
      );

      assert.equal(
        userToken1After.amount -
          userToken1Before.amount,
        expectedAmount1
      );


      /*
       * LP supply decreases by burn.
       */
      assert.equal(
        lpMintBefore.supply -
          lpMintAfter.supply,
        lpToBurn
      );


      /*
       * User LP balance decreases too.
       */
      assert.equal(
        userLpBefore.amount -
          userLpAfter.amount,
        lpToBurn
      );


      /*
       * Expected remaining state:
       *
       * reserves:
       * 750,000 / 3,000,000
       *
       * LP supply:
       * 1,500,000
       */
      assert.equal(
        vault0After.amount,
        750_000n
      );

      assert.equal(
        vault1After.amount,
        3_000_000n
      );

      assert.equal(
        lpMintAfter.supply,
        1_500_000n
      );

      assert.equal(
        userLpAfter.amount,
        1_499_000n
      );
    }
  );


  it(
    "rejects zero LP burn amount",
    async () => {
      let caughtError: unknown =
        null;

      try {
        await program.methods
          .removeLiquidity(
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

            userLpAccount,

            tokenProgram:
              TOKEN_PROGRAM_ID,
          })
          .rpc();
      } catch (error) {
        caughtError = error;
      }


      assert.isNotNull(
        caughtError,
        "Expected zero LP burn to fail"
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
    "rejects burning more LP than the provider owns",
    async () => {
      const userLp =
        await getAccount(
          provider.connection,
          userLpAccount
        );

      const burnTooMuch =
        userLp.amount + 1n;


      let caughtError: unknown =
        null;

      try {
        await program.methods
          .removeLiquidity(
            new anchor.BN(
              burnTooMuch.toString()
            ),
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

            userLpAccount,

            tokenProgram:
              TOKEN_PROGRAM_ID,
          })
          .rpc();
      } catch (error) {
        caughtError = error;
      }


      assert.isNotNull(
        caughtError,
        "Expected insufficient LP balance to fail"
      );

      assert.equal(
        getAnchorErrorCode(
          caughtError
        ),
        "InsufficientLpBalance"
      );
    }
  );


  it(
    "rejects withdrawal when minimum token-0 output is not met",
    async () => {
      /*
       * Current state:
       *
       * reserve 0 = 750,000
       * reserve 1 = 3,000,000
       * LP supply = 1,500,000
       *
       * Burn 150,000 = 10%
       *
       * expected:
       *
       * token 0 = 75,000
       * token 1 = 300,000
       *
       * We demand 75,001 token 0.
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

      const userLpBefore =
        await getAccount(
          provider.connection,
          userLpAccount
        );


      let caughtError: unknown =
        null;

      try {
        await program.methods
          .removeLiquidity(
            new anchor.BN("150000"),
            new anchor.BN("75001"),
            new anchor.BN("300000")
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

            userLpAccount,

            tokenProgram:
              TOKEN_PROGRAM_ID,
          })
          .rpc();
      } catch (error) {
        caughtError = error;
      }


      assert.isNotNull(
        caughtError,
        "Expected minimum token-0 protection to fail"
      );

      assert.equal(
        getAnchorErrorCode(
          caughtError
        ),
        "MinimumAmount0NotMet"
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

      const userLpAfter =
        await getAccount(
          provider.connection,
          userLpAccount
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

      assert.equal(
        userLpAfter.amount,
        userLpBefore.amount
      );
    }
  );


  it(
    "rejects withdrawal when minimum token-1 output is not met",
    async () => {
      /*
       * Same expected withdrawal:
       *
       * token 0 = 75,000
       * token 1 = 300,000
       *
       * Here token-0 minimum is valid,
       * but token-1 minimum is too high.
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

      const userLpBefore =
        await getAccount(
          provider.connection,
          userLpAccount
        );


      let caughtError: unknown =
        null;

      try {
        await program.methods
          .removeLiquidity(
            new anchor.BN("150000"),
            new anchor.BN("75000"),
            new anchor.BN("300001")
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

            userLpAccount,

            tokenProgram:
              TOKEN_PROGRAM_ID,
          })
          .rpc();
      } catch (error) {
        caughtError = error;
      }


      assert.isNotNull(
        caughtError,
        "Expected minimum token-1 protection to fail"
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

      const userLpAfter =
        await getAccount(
          provider.connection,
          userLpAccount
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

      assert.equal(
        userLpAfter.amount,
        userLpBefore.amount
      );
    }
  );


  it(
    "rejects an LP burn that rounds one withdrawal amount to zero",
    async () => {
      /*
       * Current state:
       *
       * reserve 0 = 750,000
       * reserve 1 = 3,000,000
       * LP supply = 1,500,000
       *
       * Burn exactly 1 LP unit:
       *
       * token 0:
       *
       * floor(
       *   750,000 × 1
       *   -------------
       *    1,500,000
       * )
       *
       * = 0
       *
       * token 1:
       *
       * floor(
       *   3,000,000 × 1
       *   ---------------
       *    1,500,000
       * )
       *
       * = 2
       *
       * Since one side rounds to zero,
       * math rejects the withdrawal.
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
          .removeLiquidity(
            new anchor.BN("1"),
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

            userLpAccount,

            tokenProgram:
              TOKEN_PROGRAM_ID,
          })
          .rpc();
      } catch (error) {
        caughtError = error;
      }


      assert.isNotNull(
        caughtError,
        "Expected zero-withdrawal rounding to fail"
      );

      assert.equal(
        getAnchorErrorCode(
          caughtError
        ),
        "ZeroWithdrawalAmount"
      );


      /*
       * Again confirm atomicity.
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
    "removes all redeemable liquidity while preserving the permanently locked share",
    async () => {
      /*
       * After the successful partial withdrawal:
       *
       * reserve 0 = 750,000
       * reserve 1 = 3,000,000
       * LP supply = 1,500,000
       *
       * user LP   = 1,499,000
       * locked LP =     1,000
       */
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

      const remainingUserLp =
        userLpBefore.amount;


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


      const userToken0Before =
        await getAccount(
          provider.connection,
          userToken0
        );

      const userToken1Before =
        await getAccount(
          provider.connection,
          userToken1
        );


      /*
       * Withdrawal is proportional to TOTAL LP supply,
       * including the permanently locked LP.
       *
       * token 0:
       * floor(750,000 × 1,499,000 / 1,500,000)
       * = 749,500
       *
       * token 1:
       * floor(3,000,000 × 1,499,000 / 1,500,000)
       * = 2,998,000
       */
      const expectedAmount0 =
        749_500n;

      const expectedAmount1 =
        2_998_000n;

      await program.methods
        .removeLiquidity(
          new anchor.BN(
            remainingUserLp.toString()
          ),
          new anchor.BN(
            expectedAmount0.toString()
          ),
          new anchor.BN(
            expectedAmount1.toString()
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

          userLpAccount,

          tokenProgram:
            TOKEN_PROGRAM_ID,
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

      const userToken0After =
        await getAccount(
          provider.connection,
          userToken0
        );

      const userToken1After =
        await getAccount(
          provider.connection,
          userToken1
        );


      /*
       * Every user-owned LP token is redeemed,
       * while the permanently locked LP remains.
       */
      assert.equal(
        userLpAfter.amount,
        0n
      );

      assert.equal(
        lockedLpAfter.amount,
        MINIMUM_LIQUIDITY
      );

      assert.equal(
        lpMintAfter.supply,
        MINIMUM_LIQUIDITY
      );

      assert.equal(
        lpMintBefore.supply -
          lpMintAfter.supply,
        remainingUserLp
      );


      /*
       * Reserves remain to back the locked LP.
       */
      assert.equal(
        vault0After.amount,
        500n
      );

      assert.equal(
        vault1After.amount,
        2_000n
      );


      assert.equal(
        userToken0After.amount -
          userToken0Before.amount,
        expectedAmount0
      );

      assert.equal(
        userToken1After.amount -
          userToken1Before.amount,
        expectedAmount1
      );


      /*
       * The first provider permanently sacrifices
       * the reserve value backing MINIMUM_LIQUIDITY.
       */
      assert.equal(
        userToken0After.amount,
        USER_INITIAL_TOKEN_0 - 500n
      );

      assert.equal(
        userToken1After.amount,
        USER_INITIAL_TOKEN_1 - 2_000n
      );

      assert.equal(
        lockedLpAfter.amount,
        lockedLpBefore.amount
      );
    }
  );
});