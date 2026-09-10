import {
  defineConfig,
} from "vite";

import react from
  "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
  ],

  resolve: {
    alias: {
      /*
       * Vite normally treats "buffer"
       * as a Node built-in and
       * externalizes it in browsers.
       *
       * The trailing slash forces
       * resolution to the npm
       * browser-compatible package.
       */
      buffer: "buffer/",
    },
  },

  optimizeDeps: {
    include: [
      "buffer",
      "@solana/spl-token",
      "@coral-xyz/anchor",
    ],
  },
});