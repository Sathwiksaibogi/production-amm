import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  AuthorityType,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
} from "@solana/spl-token";

import {
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import { expect } from "chai";

import { ProductionAmm } from "../target/types/production_amm";


describe("production-amm: devnet smoke", () => {
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

  const user =
    payer.publicKey;


  it(
    "initializes, adds liquidity, swaps, and removes liquidity on Devnet",
    async () => {
      /*
       * Safety check:
       * this test is intended for Devnet, not localnet/mainnet.
       */
      const genesisHash =
        await connection.getGenesisHash();

      console.log(
        "Connected genesis hash:",
        genesisHash,
      );

      console.log(
        "Wallet:",
        user.toBase58(),
      );

      console.log(
        "Program:",
        program.programId.toBase58(),
      );


      /*
       * Create two external SPL Token v1 mints.
       * Both use 6 decimals for a simple smoke test.
       */
      const mintA =
        await createMint(
          connection,
          payer,
          user,
          null,
          6,
        );

      const mintB =
        await createMint(
          connection,
          payer,
          user,
          null,
          6,
        );


      /*
       * Canonical ordering required by the AMM.
       */
      let token0Mint: PublicKey;
      let token1Mint: PublicKey;

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


      /*
       * Derive canonical protocol addresses.
       */
      const [pool] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("pool"),
            token0Mint.toBuffer(),
            token1Mint.toBuffer(),
          ],
          program.programId,
        );

      const vault0 =
        getAssociatedTokenAddressSync(
          token0Mint,
          pool,
          true,
        );

      const vault1 =
        getAssociatedTokenAddressSync(
          token1Mint,
          pool,
          true,
        );

      const [lpMint] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("lp_mint"),
            pool.toBuffer(),
          ],
          program.programId,
        );

      const [lockAuthority] =
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("lock_authority"),
            pool.toBuffer(),
          ],
          program.programId,
        );

      const lockedLpAccount =
        getAssociatedTokenAddressSync(
          lpMint,
          lockAuthority,
          true,
        );


      /*
       * User source token accounts.
       */
      const user0 =
        await getOrCreateAssociatedTokenAccount(
          connection,
          payer,
          token0Mint,
          user,
        );

      const user1 =
        await getOrCreateAssociatedTokenAccount(
          connection,
          payer,
          token1Mint,
          user,
        );

      const userLpAccount =
        getAssociatedTokenAddressSync(
          lpMint,
          user,
        );


      /*
       * Give the wallet test tokens before revoking
       * both external mint authorities.
       */
      await mintTo(
        connection,
        payer,
        token0Mint,
        user0.address,
        payer,
        10_000_000n,
      );

      await mintTo(
        connection,
        payer,
        token1Mint,
        user1.address,
        payer,
        40_000_000n,
      );


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
       * --------------------------------------------------
       * 1. INITIALIZE POOL
       * --------------------------------------------------
       */
      const initializeSignature =
        await program.methods
          .initializePool()
          .accounts({
            initializer:
              user,

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

      console.log(
        "initialize_pool:",
        initializeSignature,
      );


      /*
       * --------------------------------------------------
       * 2. ADD INITIAL LIQUIDITY
       * --------------------------------------------------
       *
       * sqrt(1,000,000 × 4,000,000)
       * = 2,000,000 total LP
       *
       * 1,000 LP permanently locked
       * 1,999,000 LP to provider
       */
      const initialAmount0 =
        1_000_000n;

      const initialAmount1 =
        4_000_000n;

      const minimumLiquidity =
        1_000n;

      const expectedTotalLp =
        2_000_000n;

      const expectedProviderLp =
        expectedTotalLp -
        minimumLiquidity;


      const addSignature =
        await program.methods
          .addLiquidity(
            new anchor.BN(
              initialAmount0.toString(),
            ),
            new anchor.BN(
              initialAmount1.toString(),
            ),
            new anchor.BN(
              expectedProviderLp.toString(),
            ),
          )
          .accounts({
            liquidityProvider:
              user,

            token0Mint,
            token1Mint,

            pool,

            vault0,
            vault1,

            userToken0:
              user0.address,

            userToken1:
              user1.address,

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

      console.log(
        "add_liquidity:",
        addSignature,
      );


      const vault0AfterAdd =
        await getAccount(
          connection,
          vault0,
        );

      const vault1AfterAdd =
        await getAccount(
          connection,
          vault1,
        );

      const providerLpAfterAdd =
        await getAccount(
          connection,
          userLpAccount,
        );

      const lockedLpAfterAdd =
        await getAccount(
          connection,
          lockedLpAccount,
        );


      expect(
        vault0AfterAdd.amount,
      ).to.equal(
        initialAmount0,
      );

      expect(
        vault1AfterAdd.amount,
      ).to.equal(
        initialAmount1,
      );

      expect(
        providerLpAfterAdd.amount,
      ).to.equal(
        expectedProviderLp,
      );

      expect(
        lockedLpAfterAdd.amount,
      ).to.equal(
        minimumLiquidity,
      );


      /*
       * --------------------------------------------------
       * 3. SWAP TOKEN 0 -> TOKEN 1
       * --------------------------------------------------
       */
      const token0ToToken1 = {
        token0ToToken1: {},
      } as any;

      const amountIn =
        100_000n;


      const user1BeforeSwap =
        await getAccount(
          connection,
          user1.address,
        );


      const swapSignature =
        await program.methods
          .swap(
            token0ToToken1,
            new anchor.BN(
              amountIn.toString(),
            ),
            new anchor.BN("0"),
          )
          .accounts({
            trader:
              user,

            token0Mint,
            token1Mint,

            pool,

            vault0,
            vault1,

            userToken0:
              user0.address,

            userToken1:
              user1.address,

            tokenProgram:
              TOKEN_PROGRAM_ID,
          })
          .rpc();

      console.log(
        "swap:",
        swapSignature,
      );


      const user1AfterSwap =
        await getAccount(
          connection,
          user1.address,
        );

      expect(
        user1AfterSwap.amount >
          user1BeforeSwap.amount,
      ).to.equal(true);


      /*
       * --------------------------------------------------
       * 4. REMOVE SOME LIQUIDITY
       * --------------------------------------------------
       */
      const lpToBurn =
        100_000n;

      const providerLpBeforeRemove =
        await getAccount(
          connection,
          userLpAccount,
        );

      const user0BeforeRemove =
        await getAccount(
          connection,
          user0.address,
        );

      const user1BeforeRemove =
        await getAccount(
          connection,
          user1.address,
        );


      const removeSignature =
        await program.methods
          .removeLiquidity(
            new anchor.BN(
              lpToBurn.toString(),
            ),
            new anchor.BN("0"),
            new anchor.BN("0"),
          )
          .accounts({
            liquidityProvider:
              user,

            token0Mint,
            token1Mint,

            pool,

            vault0,
            vault1,

            userToken0:
              user0.address,

            userToken1:
              user1.address,

            lpMint,

            userLpAccount,

            tokenProgram:
              TOKEN_PROGRAM_ID,
          })
          .rpc();

      console.log(
        "remove_liquidity:",
        removeSignature,
      );


      const providerLpAfterRemove =
        await getAccount(
          connection,
          userLpAccount,
        );

      const user0AfterRemove =
        await getAccount(
          connection,
          user0.address,
        );

      const user1AfterRemove =
        await getAccount(
          connection,
          user1.address,
        );


      expect(
        providerLpBeforeRemove.amount -
          providerLpAfterRemove.amount,
      ).to.equal(
        lpToBurn,
      );

      expect(
        user0AfterRemove.amount >
          user0BeforeRemove.amount,
      ).to.equal(true);

      expect(
        user1AfterRemove.amount >
          user1BeforeRemove.amount,
      ).to.equal(true);


      console.log(
        "Devnet smoke test complete.",
      );

      console.log(
        "Pool:",
        pool.toBase58(),
      );

      console.log(
        "Vault 0:",
        vault0.toBase58(),
      );

      console.log(
        "Vault 1:",
        vault1.toBase58(),
      );

      console.log(
        "LP mint:",
        lpMint.toBase58(),
      );
    },
  );
});
