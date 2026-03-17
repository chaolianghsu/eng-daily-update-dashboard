import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/eng-daily-update-dashboard/",
  build: {
    outDir: "dist",
  },
});
