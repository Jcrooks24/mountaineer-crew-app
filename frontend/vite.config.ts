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

  // Build identifier surfaced on the Profile page so crew can verify they're
  // on a fresh build after tapping "Check for updates". Prefer a Vercel-
  // provided commit SHA; fall back to the local build timestamp so local
  // dev builds still show something meaningful.
  const commitSha = env.VITE_BUILD_ID || env.VERCEL_GIT_COMMIT_SHA || "";
  const shortSha = commitSha ? commitSha.slice(0, 7) : "";
  const buildStamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
  const buildId = shortSha ? `${shortSha}-${buildStamp}` : `dev-${buildStamp}`;

  // The raw buildId reads like noise to crew. Derive a friendly two-word
  // version NAME from it — "Brave Otter" instead of "a1b2c3d-2026051512".
  // It's deterministic per build (same buildId always maps to the same
  // name) and the two indices are hashed independently so consecutive
  // builds land on unrelated names. The buildId itself stays the precise
  // identifier underneath, so even on the rare hash collision two builds
  // are still distinguishable.
  const VERSION_ADJECTIVES = [
    "amber", "azure", "brave", "bright", "brisk", "calm", "clever", "cobalt",
    "coral", "cosmic", "crimson", "crisp", "dapper", "deep", "eager", "ember",
    "fair", "fleet", "frosty", "gentle", "gilded", "golden", "grand", "hardy",
    "hazel", "ivory", "jade", "jolly", "keen", "kind", "lively", "lofty",
    "lucky", "lunar", "maple", "merry", "mighty", "misty", "noble", "olive",
    "opal", "pale", "plucky", "prime", "proud", "quick", "quiet", "rapid",
    "royal", "ruby", "rustic", "sage", "scarlet", "silver", "sleek", "snowy",
    "solar", "spry", "steady", "stout", "sunny", "swift", "tidy", "trusty",
    "vivid", "warm", "wise", "witty", "woven", "zesty",
  ];
  const VERSION_NOUNS = [
    "otter", "heron", "falcon", "badger", "beaver", "bison", "bobcat",
    "cougar", "condor", "coyote", "crane", "dolphin", "eagle", "egret",
    "elk", "ermine", "ferret", "finch", "fox", "gecko", "hare", "hawk",
    "ibis", "jackal", "jaguar", "kestrel", "lark", "lemur", "lynx", "marmot",
    "marten", "mink", "moose", "narwhal", "ocelot", "orca", "osprey", "owl",
    "panda", "panther", "pelican", "puffin", "quail", "rabbit", "raccoon",
    "raven", "robin", "salmon", "seal", "sparrow", "stag", "stoat", "swan",
    "tapir", "tern", "thrush", "toucan", "trout", "turtle", "viper", "vole",
    "walrus", "weasel", "whale", "wolf", "wombat", "wren", "yak", "bear",
    "crow", "dove",
  ];
  // FNV-1a 32-bit — small, deterministic, well-spread for short strings.
  const fnv1a = (s: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const adj = VERSION_ADJECTIVES[fnv1a(buildId) % VERSION_ADJECTIVES.length];
  const noun = VERSION_NOUNS[fnv1a(`${buildId}::noun`) % VERSION_NOUNS.length];
  const versionName = `${cap(adj)} ${cap(noun)}`;

  return {
    define: {
      __APP_BUILD_ID__: JSON.stringify(buildId),
      __APP_VERSION_NAME__: JSON.stringify(versionName),
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
