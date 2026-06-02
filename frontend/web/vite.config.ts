import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            // Cache GET API responses, but NEVER intercept SSE streams or
            // session status checks — the SW's NetworkFirst handler will
            // hold the request for `networkTimeoutSeconds` and then try
            // to serve from cache, which is fatal for streaming endpoints
            // and silently stales-out the visibility-change reconnect.
            urlPattern: ({ url }) => {
              if (!url.pathname.startsWith("/api/")) return false;
              if (url.pathname.endsWith("/stream")) return false;
              if (url.pathname.endsWith("/status")) return false;
              if (url.pathname.includes("/active/")) return false;
              return true;
            },
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "../../shared/src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "../../dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
