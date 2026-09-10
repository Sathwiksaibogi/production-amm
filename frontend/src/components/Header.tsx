import {
  WalletMultiButton,
} from "@solana/wallet-adapter-react-ui";

import {
  NETWORK,
} from "../config/solana";

export type Page =
  | "swap"
  | "liquidity"
  | "pools";

type HeaderProps = {
  activePage: Page;

  onNavigate: (
    page: Page
  ) => void;
};

export function Header({
  activePage,
  onNavigate,
}: HeaderProps) {
  return (
    <header className="header">
      <div className="brand">
        <div className="brand-logo">
          <span />
          <span />
          <span />
        </div>

        <div>
          <div className="brand-name">
            Invariant
          </div>

          <div className="brand-caption">
            Constant Product AMM
          </div>
        </div>
      </div>

      <nav className="navigation">

        <button
          className={
            activePage === "pools"
              ? "nav-button active"
              : "nav-button"
          }
          onClick={() =>
            onNavigate("pools")
          }
        >
          Pools
        </button>

        <button
          className={
            activePage === "swap"
              ? "nav-button active"
              : "nav-button"
          }
          onClick={() =>
            onNavigate("swap")
          }
        >
          Swap
        </button>

        <button
          className={
            activePage ===
            "liquidity"
              ? "nav-button active"
              : "nav-button"
          }
          onClick={() =>
            onNavigate(
              "liquidity"
            )
          }
        >
          Liquidity
        </button>

        
      </nav>

      <div className="header-right">
        <div className="network-badge">
          <span className="network-dot" />

          {NETWORK}
        </div>

        <WalletMultiButton />
      </div>
    </header>
  );
}