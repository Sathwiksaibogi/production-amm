import {
  useState,
} from "react";

import {
  Header,
  type Page,
} from "./components/Header";

import {
  LiquidityPage,
} from "./pages/LiquidityPage";

import {
  PoolsPage,
} from "./pages/PoolsPage";

import {
  SwapPage,
} from "./pages/SwapPage";

import {
  DEFAULT_POOL,
  PROGRAM_ID,
  explorerAddressUrl,
} from "./config/solana";

import {
  shortenAddress,
} from "./amm/amounts";

import "./App.css";


function App() {
  const [
    page,
    setPage,
  ] =
    useState<Page>(
      "pools"
    );

  const [
    activePool,
    setActivePool,
  ] =
    useState(
      DEFAULT_POOL
    );

  const programAddress =
    PROGRAM_ID.toBase58();


  function selectPool(
    pool: string
  ) {
    setActivePool(pool);
  }


  return (
    <div className="app">
      <div className="glow glow-one" />
      <div className="glow glow-two" />

      <Header
        activePage={page}
        onNavigate={setPage}
      />


      <main className="main">

        {/* HERO */}

        <section className="hero">
          <div className="hero-copy">

            <div className="section-label">
              SOLANA · DEVNET
            </div>

            <h1>
              Liquidity without
              hidden assumptions.
            </h1>

            <p>
              A constant-product AMM
              built around deterministic
              pools, canonical vaults,
              explicit slippage
              protection, and hardened
              liquidity accounting.
            </p>

          </div>


          <div className="verified-card">

            <div className="check">
              ✓
            </div>

            <div>
              <strong>
                Devnet verified
              </strong>

              <span>
                Full protocol lifecycle
                executed on-chain
              </span>
            </div>

          </div>
        </section>


        {/* PROTOCOL METRICS */}

        <section className="metrics">

          <div className="metric-card">
            <span>
              Swap fee
            </span>

            <strong>
              0.30%
            </strong>

            <small>
              Retained by LPs
            </small>
          </div>


          <div className="metric-card">
            <span>
              Minimum liquidity
            </span>

            <strong>
              1,000 LP
            </strong>

            <small>
              Locked by current program
            </small>
          </div>


          <div className="metric-card">
            <span>
              Active pool
            </span>

            <strong
              title={activePool}
            >
              {shortenAddress(
                activePool,
                5
              )}
            </strong>

            <small>
              User selectable
            </small>
          </div>


          <div className="metric-card">
            <span>
              Program
            </span>

            <a
              href={
                explorerAddressUrl(
                  programAddress
                )
              }
              target="_blank"
              rel="noreferrer"
            >
              {shortenAddress(
                programAddress,
                6
              )}
              ↗
            </a>

            <small>
              Upgradeable
            </small>
          </div>

        </section>


        {/* MAIN WORKSPACE */}

        <section className="workspace">

          {/* SMALL PROTOCOL INFORMATION COLUMN */}

          <aside className="protocol-info compact-protocol">

            <div>

              <div className="section-label">
                PROTOCOL DESIGN
              </div>

              <h2>
                Strong
                invariants.
              </h2>

              <p>
                Canonical addresses,
                deterministic pools and
                on-chain enforced
                liquidity rules.
              </p>

            </div>


            <div className="feature-list">

              <div>
                <span>01</span>

                Canonical mint ordering
              </div>

              <div>
                <span>02</span>

                Deterministic Pool PDA
              </div>

              <div>
                <span>03</span>

                Canonical vault ATAs
              </div>

              <div>
                <span>04</span>

                Locked minimum liquidity
              </div>

              <div>
                <span>05</span>

                Minimum-output protection
              </div>

            </div>

          </aside>


          {/* LARGE INTERACTIVE COLUMN */}

          <section className="interface primary-interface">

            {page === "swap" && (
              <SwapPage
                poolAddress={
                  activePool
                }
              />
            )}


            {page ===
              "liquidity" && (
              <LiquidityPage
                  poolAddress={
                    activePool
                  }
                />
            )}


            {page === "pools" && (
              <PoolsPage
                activePool={
                  activePool
                }
                onSelectPool={
                  selectPool
                }
              />
            )}

          </section>

        </section>


        {/* FOOTER */}

        <footer>

          <div>
            INVARIANT
          </div>

          <span>
            Production-oriented
            constant-product AMM
            on Solana
          </span>

        </footer>

      </main>
    </div>
  );
}


export default App;