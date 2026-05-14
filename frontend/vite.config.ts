import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  // Load env so VITE_API_URL is available at config time (for the service worker).
  // The service worker is compiled at build time — it can't read runtime env vars,
  // so we bake the API origin in here. Each deployment (prod vs staging) will get
  // its own compiled SW that only caches requests to its own backend.
  const env = loadEnv(mode, process.cwd(), "");
  let apiOrigin = "http://127.0.0.1:8000";
  try {
    if (env.VITE_API_URL) apiOrigin = new URL(env.VITE_API_URL).origin;
  } catch (_e) {
    // malformed URL — fall back to localhost so the build doesn't break
  }

  // Build identifier surfaced in the Profile "Crew Settings" card so crew can
  // verify they're on a fresh build after tapping "Check for updates". Prefer
  // a Vercel-provided commit SHA; fall back to the local build timestamp so
  // local dev builds still show something meaningful.
  const commitSha = env.VITE_BUILD_ID || env.VERCEL_GIT_COMMIT_SHA || "";
  const shortSha = commitSha ? commitSha.slice(0, 7) : "";
  const buildStamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
  const buildId = shortSha ? `${shortSha}-${buildStamp}` : `dev-${buildStamp}`;

  return {
    define: {
      __APP_BUILD_ID__: JSON.stringify(buildId),
    },
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
                url.origin === apiOrigin &&
                request.method === "GET" &&
                url.pathname.startsWith("/api/calendar/"),
              handler: "NetworkFirst",
              options: {
                cacheName: "api-calendar",
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 }, // 7 days
              },
            },

            // ✅ "me" endpoint (GET) – okay to network-first; cache short
            // (If offline, returning last-known user can keep UI alive.)
            {
              urlPattern: ({ url, request }) =>
                url.origin === apiOrigin &&
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
                url.origin === apiOrigin &&
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
            // We don't add rules for them; Workbox won't cache them by default.
          ],
        },
      }),
    ],
  };
});
