import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      // Auto-register SW; auto-update when you deploy new builds
      registerType: "autoUpdate",
      injectRegister: "auto",

      // Manifest served as /manifest.webmanifest
      manifest: {
        name: "Mountaineer Crew App",
        short_name: "Crew App",
        description: "Field job logging for moving crews",
        display: "standalone",
        start_url: "/",
        scope: "/",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        icons: [
          { src: "/icons/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/pwa-512.png", sizes: "512x512", type: "image/png" },
        ],
      },

      // What gets precached (your app shell)
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp}"],

        // Runtime caching: cache GET reads that are safe; never cache auth
        runtimeCaching: [
          // ✅ Calendar/day (GET, read-mostly)
          {
            urlPattern: ({ url, request }) =>
              url.origin === "https://mountaineer-crew-app-ar5n.onrender.com" &&
              request.method === "GET" &&
              url.pathname.startsWith("/api/calendar/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-calendar",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 }, // 7 days
            },
          },

          // ✅ “me” endpoint (GET) – okay to network-first; cache short
          // (If offline, returning last-known user can keep UI alive.)
          {
            urlPattern: ({ url, request }) =>
              url.origin === "https://mountaineer-crew-app-ar5n.onrender.com" &&
              request.method === "GET" &&
              url.pathname === "/api/auth/me",
            handler: "NetworkFirst",
            options: {
              cacheName: "api-auth-me",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 10 }, // 10 minutes
            },
          },

          // ✅ Jobs router reads (GET)
          {
            urlPattern: ({ url, request }) =>
              url.origin === "https://mountaineer-crew-app-ar5n.onrender.com" &&
              request.method === "GET" &&
              (url.pathname === "/api/jobs" || url.pathname.startsWith("/api/jobs/")),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-jobs",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 3 }, // 3 days
            },
          },

          // ❌ Explicitly DO NOT cache login/signup/sync (POST, auth-sensitive)
          // We don't add rules for them; Workbox won’t cache them by default.
        ],
      },
    }),
  ],
});