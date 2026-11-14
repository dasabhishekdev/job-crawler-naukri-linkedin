import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.API_PROXY_TARGET || "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3006,
    host: true,
    proxy: {
      "/api/portals/ws": { target: process.env.BROWSER_PROXY_TARGET || "ws://localhost:5100", ws: true },
      "/api": { target: API_TARGET, changeOrigin: false },
    },
  },
  preview: { port: 3006, host: true },
});
