# 0006. The service worker prompts for updates; it never auto-updates

**Status:** Active.

## Context

`vite-plugin-pwa` offers `registerType: "autoUpdate"`, which installs a new build
and reloads the page as soon as it is available. That is the default advice and it
is wrong for this app.

Our users are standing in a truck, mid-form, entering a customer's inventory or
capturing a signature. Some of them have a queue of unsynced work on the device.

An automatic reload can land:

- in the middle of data entry, losing whatever is in the form,
- in the middle of a queue drain,
- while the customer is signing the Bill of Lading.

## Decision

**`registerType: "prompt"`.** A new build installs and then *waits*. It does not
activate. `UpdateBanner.tsx` detects the waiting worker and offers the crew a
banner. They apply it when they are between tasks.

`lib/appUpdate.ts` posts `SKIP_WAITING` and reloads on `controllerchange`, with an
8 second fallback to a plain reload if the worker does not hand over.

## Consequences

- **Crews can be running an old build for a while, and that is fine.** Do not treat
  "the fix deployed but they still see the old version" as a bug. It is this.
- Anything that must reach every device promptly (a breaking API change) needs to be
  backward compatible on the server for at least as long as it takes crews to accept
  the banner. Do not ship a server change that breaks the previous frontend build.
- The banner re-checks every 20 minutes and on window focus, throttled to 5 minutes.

## What would break if you undid this

Switching to `autoUpdate` would reload phones mid-signature and mid-form. The bug
reports would be sporadic, unreproducible, and blamed on something else entirely.
