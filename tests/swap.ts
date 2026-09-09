import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";

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
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import { ProductionAmm } from "../target/types/production_amm";

describe("production-amm: swap", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.productionAmm as Program<ProductionAmm>;

  const connection = provider.connection;
  const trader = provider.wallet.publicKey;

  const SWAP_FEE_BPS = 30n;
  const BPS_DENOMINATOR = 10_000n;

  const setupPayer = Keypair.generate();

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

  const initialReserve0 = 1_000_000n;
  const initialReserve1 = 4_000_000n;

  const initialUserToken0 = 10_000_000n;
  const initialUserToken1 = 40_000_000n;

  const initialLpSupply = 2_000_000n;
  const minimumLiquidity = 1_000n;
  const initialProviderLp =
    initialLpSupply - minimumLiquidity;

  const token0ToToken1 = {
    token0ToToken1: {},
  } as any;

  const token1ToToken0 = {
    token1ToToken0: {},
  } as any;

  function calculateExpectedOutput(
    reserveIn: bigint,
    reserveOut: bigint,
    amountIn: bigint,
  ): bigint {
    const feeAmount =
      (amountIn * SWAP_FEE_BPS) / BPS_DENOMINATOR;

    const amountInAfterFee =
      amountIn - feeAmount;

    return (
      reserveOut *
      amountInAfterFee
    ) / (
      reserveIn +
      amountInAfterFee
    );
  }

  function getAnchorErrorCode(error: any): string | undefined {
    if (error?.error?.errorCode?.code) {
      return error.error.errorCode.code;
    }

    if (error?.errorCode?.code) {
      return error.errorCode.code;
    }

    const logs: string[] | undefined = error?.logs;

    if (logs) {
      for (const log of logs) {
        const match = log.match(/Error Code: ([A-Za-z0-9_]+)/);

        if (match) {
          return match[1];
        }
      }
    }

    return undefined;
  }

  async function expectAnchorError(
    promise: Promise<unknown>,
    expectedCode: string,
  ) {
    let caughtError: any;

    try {
      await promise;
    } catch (error) {
      caughtError = error;
    }

    expect(
      caughtError,
      `Expected transaction to fail with ${expectedCode}`,
    ).to.not.equal(undefined);

    expect(getAnchorErrorCode(caughtError)).to.equal(
      expectedCode,
    );
  }

  before(async () => {
    const signature = await connection.requestAirdrop(
      setupPayer.publicKey,
      5 * LAMPORTS_PER_SOL,
    );

    await connection.confirmTransaction(
      signature,
      "confirmed",
    );

    const mintA = await createMint(
      connection,
      setupPayer,
      setupPayer.publicKey,
      null,
      6,
    );

    const mintB = await createMint(
      connection,
      setupPayer,
      setupPayer.publicKey,
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

    [pool] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        token0Mint.toBuffer(),
        token1Mint.toBuffer(),
      ],
      program.programId,
    );

    vault0 = getAssociatedTokenAddressSync(
      token0Mint,
      pool,
      true,
    );

    vault1 = getAssociatedTokenAddressSync(
      token1Mint,
      pool,
      true,
    );

    [lpMint] = PublicKey.findProgramAddressSync(
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

    const token0Account =
      await getOrCreateAssociatedTokenAccount(
        connection,
        setupPayer,
        token0Mint,
        trader,
      );

    const token1Account =
      await getOrCreateAssociatedTokenAccount(
        connection,
        setupPayer,
        token1Mint,
        trader,
      );

    userToken0 = token0Account.address;
    userToken1 = token1Account.address;

    userLpAccount = getAssociatedTokenAddressSync(
      lpMint,
      trader,
    );

    await mintTo(
      connection,
      setupPayer,
      token0Mint,
      userToken0,
      setupPayer,
      initialUserToken0,
    );

    await mintTo(
      connection,
      setupPayer,
      token1Mint,
      userToken1,
      setupPayer,
      initialUserToken1,
    );

    // Mint the complete test supply first, then
    // permanently revoke MintTokens authority.
    await setAuthority(
      connection,
      setupPayer,
      token0Mint,
      setupPayer,
      AuthorityType.MintTokens,
      null,
    );

    await setAuthority(
      connection,
      setupPayer,
      token1Mint,
      setupPayer,
      AuthorityType.MintTokens,
      null,
    );

    await program.methods
      .initializePool()
      .accounts({
        initializer: trader,
        token0Mint,
        token1Mint,
        pool,
        vault0,
        vault1,
        lpMint,
        lockAuthority,
        lockedLpAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram:
          ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    await program.methods
      .addLiquidity(
        new anchor.BN(initialReserve0.toString()),
        new anchor.BN(initialReserve1.toString()),
        new anchor.BN(initialProviderLp.toString()),
      )
      .accounts({
        liquidityProvider: trader,
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
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram:
          ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
  });

  it("starts with the expected seeded pool state", async () => {
    const vault0Account = await getAccount(
      connection,
      vault0,
    );

    const vault1Account = await getAccount(
      connection,
      vault1,
    );

    const lpMintAccount = await getMint(
      connection,
      lpMint,
    );

    const lockedLp = await getAccount(
      connection,
      lockedLpAccount,
    );

    const providerLp = await getAccount(
      connection,
      userLpAccount,
    );

    expect(vault0Account.amount).to.equal(
      initialReserve0,
    );

    expect(vault1Account.amount).to.equal(
      initialReserve1,
    );

    expect(lpMintAccount.supply).to.equal(
      initialLpSupply,
    );

    expect(lockedLp.amount).to.equal(
      minimumLiquidity,
    );

    expect(providerLp.amount).to.equal(
      initialProviderLp,
    );
  });

  it("swaps token 0 for token 1 using the constant-product formula", async () => {
    const amountIn = 100_000n;

    const vault0Before = await getAccount(
      connection,
      vault0,
    );

    const vault1Before = await getAccount(
      connection,
      vault1,
    );

    const user0Before = await getAccount(
      connection,
      userToken0,
    );

    const user1Before = await getAccount(
      connection,
      userToken1,
    );

    const expectedAmountOut =
      calculateExpectedOutput(
        vault0Before.amount,
        vault1Before.amount,
        amountIn,
      );

    const kBefore =
      vault0Before.amount *
      vault1Before.amount;

    await program.methods
      .swap(
        token0ToToken1,
        new anchor.BN(amountIn.toString()),
        new anchor.BN(expectedAmountOut.toString()),
      )
      .accounts({
        trader,
        token0Mint,
        token1Mint,
        pool,
        vault0,
        vault1,
        userToken0,
        userToken1,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const vault0After = await getAccount(
      connection,
      vault0,
    );

    const vault1After = await getAccount(
      connection,
      vault1,
    );

    const user0After = await getAccount(
      connection,
      userToken0,
    );

    const user1After = await getAccount(
      connection,
      userToken1,
    );

    expect(
      vault0After.amount -
        vault0Before.amount,
    ).to.equal(amountIn);

    expect(
      vault1Before.amount -
        vault1After.amount,
    ).to.equal(expectedAmountOut);

    expect(
      user0Before.amount -
        user0After.amount,
    ).to.equal(amountIn);

    expect(
      user1After.amount -
        user1Before.amount,
    ).to.equal(expectedAmountOut);

    const kAfter =
      vault0After.amount *
      vault1After.amount;

    expect(kAfter >= kBefore).to.equal(true);
  });

  it("swaps token 1 for token 0 in the reverse direction", async () => {
    const amountIn = 200_000n;

    const vault0Before = await getAccount(
      connection,
      vault0,
    );

    const vault1Before = await getAccount(
      connection,
      vault1,
    );

    const user0Before = await getAccount(
      connection,
      userToken0,
    );

    const user1Before = await getAccount(
      connection,
      userToken1,
    );

    const expectedAmountOut =
      calculateExpectedOutput(
        vault1Before.amount,
        vault0Before.amount,
        amountIn,
      );

    const kBefore =
      vault0Before.amount *
      vault1Before.amount;

    await program.methods
      .swap(
        token1ToToken0,
        new anchor.BN(amountIn.toString()),
        new anchor.BN(expectedAmountOut.toString()),
      )
      .accounts({
        trader,
        token0Mint,
        token1Mint,
        pool,
        vault0,
        vault1,
        userToken0,
        userToken1,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const vault0After = await getAccount(
      connection,
      vault0,
    );

    const vault1After = await getAccount(
      connection,
      vault1,
    );

    const user0After = await getAccount(
      connection,
      userToken0,
    );

    const user1After = await getAccount(
      connection,
      userToken1,
    );

    expect(
      vault1After.amount -
        vault1Before.amount,
    ).to.equal(amountIn);

    expect(
      vault0Before.amount -
        vault0After.amount,
    ).to.equal(expectedAmountOut);

    expect(
      user1Before.amount -
        user1After.amount,
    ).to.equal(amountIn);

    expect(
      user0After.amount -
        user0Before.amount,
    ).to.equal(expectedAmountOut);

    const kAfter =
      vault0After.amount *
      vault1After.amount;

    expect(kAfter >= kBefore).to.equal(true);
  });

  it("rejects a swap when minimum output is not met and leaves balances unchanged", async () => {
    const amountIn = 50_000n;

    const vault0Before = await getAccount(
      connection,
      vault0,
    );

    const vault1Before = await getAccount(
      connection,
      vault1,
    );

    const user0Before = await getAccount(
      connection,
      userToken0,
    );

    const user1Before = await getAccount(
      connection,
      userToken1,
    );

    const expectedAmountOut =
      calculateExpectedOutput(
        vault0Before.amount,
        vault1Before.amount,
        amountIn,
      );

    await expectAnchorError(
      program.methods
        .swap(
          token0ToToken1,
          new anchor.BN(amountIn.toString()),
          new anchor.BN(
            (expectedAmountOut + 1n).toString(),
          ),
        )
        .accounts({
          trader,
          token0Mint,
          token1Mint,
          pool,
          vault0,
          vault1,
          userToken0,
          userToken1,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "MinimumAmountOutNotMet",
    );

    const vault0After = await getAccount(
      connection,
      vault0,
    );

    const vault1After = await getAccount(
      connection,
      vault1,
    );

    const user0After = await getAccount(
      connection,
      userToken0,
    );

    const user1After = await getAccount(
      connection,
      userToken1,
    );

    expect(vault0After.amount).to.equal(
      vault0Before.amount,
    );

    expect(vault1After.amount).to.equal(
      vault1Before.amount,
    );

    expect(user0After.amount).to.equal(
      user0Before.amount,
    );

    expect(user1After.amount).to.equal(
      user1Before.amount,
    );
  });

  it("rejects a zero input amount", async () => {
    await expectAnchorError(
      program.methods
        .swap(
          token0ToToken1,
          new anchor.BN(0),
          new anchor.BN(0),
        )
        .accounts({
          trader,
          token0Mint,
          token1Mint,
          pool,
          vault0,
          vault1,
          userToken0,
          userToken1,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "InvalidAmount",
    );
  });

  it("rejects a swap that rounds the output down to zero", async () => {
    const amountIn = 1n;

    const vault0Account = await getAccount(
      connection,
      vault0,
    );

    const vault1Account = await getAccount(
      connection,
      vault1,
    );

    const expectedOutput =
      calculateExpectedOutput(
        vault1Account.amount,
        vault0Account.amount,
        amountIn,
      );

    expect(expectedOutput).to.equal(0n);

    await expectAnchorError(
      program.methods
        .swap(
          token1ToToken0,
          new anchor.BN(amountIn.toString()),
          new anchor.BN(0),
        )
        .accounts({
          trader,
          token0Mint,
          token1Mint,
          pool,
          vault0,
          vault1,
          userToken0,
          userToken1,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "ZeroSwapOutput",
    );
  });

  it("rejects swaps against an empty pool", async () => {
    const mintA = await createMint(
      connection,
      setupPayer,
      setupPayer.publicKey,
      null,
      6,
    );

    const mintB = await createMint(
      connection,
      setupPayer,
      setupPayer.publicKey,
      null,
      6,
    );

    let emptyToken0Mint: PublicKey;
    let emptyToken1Mint: PublicKey;

    if (
      Buffer.compare(
        mintA.toBuffer(),
        mintB.toBuffer(),
      ) < 0
    ) {
      emptyToken0Mint = mintA;
      emptyToken1Mint = mintB;
    } else {
      emptyToken0Mint = mintB;
      emptyToken1Mint = mintA;
    }

    const [emptyPool] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("pool"),
          emptyToken0Mint.toBuffer(),
          emptyToken1Mint.toBuffer(),
        ],
        program.programId,
      );

    const emptyVault0 =
      getAssociatedTokenAddressSync(
        emptyToken0Mint,
        emptyPool,
        true,
      );

    const emptyVault1 =
      getAssociatedTokenAddressSync(
        emptyToken1Mint,
        emptyPool,
        true,
      );

    const [emptyLpMint] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("lp_mint"),
          emptyPool.toBuffer(),
        ],
        program.programId,
      );

    const [emptyLockAuthority] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("lock_authority"),
          emptyPool.toBuffer(),
        ],
        program.programId,
      );

    const emptyLockedLpAccount =
      getAssociatedTokenAddressSync(
        emptyLpMint,
        emptyLockAuthority,
        true,
      );

    const emptyUser0 =
      await getOrCreateAssociatedTokenAccount(
        connection,
        setupPayer,
        emptyToken0Mint,
        trader,
      );

    const emptyUser1 =
      await getOrCreateAssociatedTokenAccount(
        connection,
        setupPayer,
        emptyToken1Mint,
        trader,
      );

    // This pool intentionally has no liquidity, so
    // there is no test supply to mint. Revoke both
    // mint authorities before initialization.
    await setAuthority(
      connection,
      setupPayer,
      emptyToken0Mint,
      setupPayer,
      AuthorityType.MintTokens,
      null,
    );

    await setAuthority(
      connection,
      setupPayer,
      emptyToken1Mint,
      setupPayer,
      AuthorityType.MintTokens,
      null,
    );

    await program.methods
      .initializePool()
      .accounts({
        initializer: trader,
        token0Mint: emptyToken0Mint,
        token1Mint: emptyToken1Mint,
        pool: emptyPool,
        vault0: emptyVault0,
        vault1: emptyVault1,
        lpMint: emptyLpMint,
        lockAuthority: emptyLockAuthority,
        lockedLpAccount: emptyLockedLpAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram:
          ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    await expectAnchorError(
      program.methods
        .swap(
          token0ToToken1,
          new anchor.BN(1000),
          new anchor.BN(0),
        )
        .accounts({
          trader,
          token0Mint: emptyToken0Mint,
          token1Mint: emptyToken1Mint,
          pool: emptyPool,
          vault0: emptyVault0,
          vault1: emptyVault1,
          userToken0: emptyUser0.address,
          userToken1: emptyUser1.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "InvalidPoolState",
    );
  });
});