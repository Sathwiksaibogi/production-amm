# K-Invariant

**Constant-product liquidity on Solana.**

K-Invariant is a production-oriented constant-product AMM frontend built for a custom Solana program using Rust, Anchor, SPL Token, React, and TypeScript.

The interface connects directly to the deployed Solana Devnet program and supports permissionless pool creation, swaps, liquidity provisioning, and liquidity removal.

## Features

- Phantom wallet integration
- Solana Devnet support
- Permissionless canonical pool creation
- Deterministic Pool PDA derivation
- Canonical SPL Token vaults
- Live reserve and wallet balance reads
- Exact-input token swaps
- 0.30% swap fee
- Price-impact estimation
- Minimum-output slippage protection
- Initial liquidity provisioning
- Optimal subsequent liquidity provisioning
- LP token minting and burning
- Minimum-liquidity locking
- Live LP supply and user LP balances
- Solana Explorer transaction links

## AMM Model

K-Invariant uses the constant-product invariant:

```text
x × y = k

```
where:

x represents the Token 0 reserve
y represents the Token 1 reserve
k represents the constant-product invariant

Swaps modify the reserve ratio while the AMM pricing function determines output amounts.

Liquidity Model

For the initial deposit:

LP_total = floor(sqrt(amount_0 × amount_1))

A minimum amount of LP is locked by the program, while the remaining LP tokens are minted to the liquidity provider.

For subsequent deposits, K-Invariant calculates the LP contribution supported by each desired token amount:

lp_from_0 =
amount_0_desired × lp_supply / reserve_0

lp_from_1 =
amount_1_desired × lp_supply / reserve_1

lp_minted =
min(lp_from_0, lp_from_1)

Only the optimal proportional token amounts are transferred.

Protocol Properties

K-Invariant is designed around several protocol invariants:

canonical token mint ordering
one deterministic pool PDA per token pair
canonical vault ATAs
canonical LP mint
locked minimum liquidity
exact-input swap execution
minimum-output protection
user-defined liquidity bounds
integer-only arithmetic
u128 intermediate calculations
on-chain validation of all critical accounts
Tech Stack
Protocol
Rust
Anchor 0.32.1
Solana
SPL Token
Frontend
React
TypeScript
Vite
Anchor TypeScript client
Solana Web3.js
Solana Wallet Adapter
SPL Token JavaScript SDK
Devnet Deployment
Program ID
HVyRymResYhpSjAeLfQcabBTD8s15uXVzGZJUH5HjDHC

Network:

Solana Devnet

The current deployment remains upgradeable while the project is under active development.

Testing

The protocol currently includes:

65 Rust AMM math tests
44 Anchor integration tests
1 Devnet lifecycle smoke test

The Devnet smoke test verifies the full lifecycle:

initialize_pool
      ↓
add_liquidity
      ↓
swap
      ↓
remove_liquidity

The frontend has also been manually verified against the deployed Devnet program using Phantom for:

Pool creation
Initial liquidity
Subsequent optimal liquidity
Swaps
Liquidity removal
LP minting and burning
Live balance refresh

Running Locally

Install dependencies:

yarn install

Create a local environment file:

cp .env.example .env

Start the frontend:

yarn dev

Production build:

yarn build
Environment Variables
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_AMM_PROGRAM_ID=HVyRymResYhpSjAeLfQcabBTD8s15uXVzGZJUH5HjDHC
VITE_DEFAULT_POOL=<DEVNET_POOL_ADDRESS>
Security Notes

K-Invariant includes protections against several common AMM and Solana integration issues, including:

account substitution
non-canonical vault usage
fake LP token substitution
duplicate pool initialization
invalid token mint authorities
invalid freeze authorities
zero-value operations
arithmetic overflow through widened intermediates
liquidity-share inflation through minimum-liquidity locking
stale-price execution through minimum-output checks

The project has not undergone an independent security audit and should not be treated as production-secure for mainnet assets.

Status

K-Invariant is currently a Devnet-tested, production-oriented Solana protocol engineering project.