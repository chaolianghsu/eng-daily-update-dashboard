import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["tests/unit/**", "jsdom"],
      ["tests/components/**", "jsdom"],
    ],
    setupFiles: ["tests/setup.ts"],
  },
});
