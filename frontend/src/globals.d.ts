// Build-time constants injected by vite.config.ts via `define`.
// Surfaced on the Profile page so crew can verify they're on a fresh build
// after tapping "Check for updates".
//   __APP_VERSION_NAME__ — friendly two-word name, e.g. "Brave Otter".
//   __APP_BUILD_ID__      — precise build identifier (commit + timestamp).
declare const __APP_BUILD_ID__: string;
declare const __APP_VERSION_NAME__: string;
