import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-appscript",
    cssCodeSplit: false,
    rollupOptions: {
      input: "src/main.appscript.tsx",
      output: {
        inlineDynamicImports: true,
        entryFileNames: "bundle.js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
