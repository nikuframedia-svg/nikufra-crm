import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/api/outreach": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
  envPrefix: "VITE_",
  build: { target: ["es2021", "chrome100", "safari15"] },
});
