import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["tests/unit/**", "jsdom"],
      ["tests/components/**", "jsdom"],
    ],
    setupFiles: ["tests/setup.ts"],
  },
});
