import "./polyfills";

import {
  StrictMode,
} from "react";

import {
  createRoot,
} from "react-dom/client";

import
  "@solana/wallet-adapter-react-ui/styles.css";

import {
  SolanaProvider,
} from "./components/SolanaProvider";

import App from "./App";

import "./index.css";

createRoot(
  document.getElementById(
    "root"
  )!
).render(
  <StrictMode>
    <SolanaProvider>
      <App />
    </SolanaProvider>
  </StrictMode>
);