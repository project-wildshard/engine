# 2026-11-19: an update reaches a home-screen app in one foreground

Lane: buddy-engine (QA-FEEDBACK-2026-11-19 row 50).

Jake, 16:04 Cancún: his iPhone home-screen app still said V0.1.50 on the title, with no "new … tap to update", a
quarter of an hour after staging's /version.json moved to 0.1.52, and he "can't refresh to 0.1.52".

Staging was not the problem. Its cf-cache-status HIT on `/`, `/sw.js` and `/version.json` is Workers static assets
serving the live deployment's own files (a query string the edge never saw is a HIT too, and `/` carried cf47558e).
sw.js is a per-build stub, so the worker saw a byte change.

The app was the problem, in two places:

- **The pill.** On a page the worker controls, Update.ts ignored version.json and lit only on `ws-sw-waiting`: the
  new worker installed. Over a device that holds its whole generation (anyone who has played a zone), the new worker's
  install first downloads its own whole generation, about 60 MB, and iOS keeps that from finishing in the background
  and in Low Power Mode. The install also calls skipWaiting, so `installed` can pass before `announce` reads it. The
  pill stayed dark.
- **The reload.** The old worker holds its generation, so `navigation()` answered every reload with its baked
  document, the old shell, until the new worker took over.

The fix:

- version.json lights the pill on every page, the controlled one too, and a worker that leaves `installed` no
  longer dims it while a newer build is live. A bfcache `pageshow` is a foreground too.
- Every read tells the controlling worker the live build (`LIVE`, boot/sw.ts).
- The worker answers a navigation network-first once a newer build is live, with its baked document as the
  NAVIGATION_WAIT_MS fallback, so offline still boots. A tap with no installed worker reloads, and that reload is the
  new shell. An installed worker is still adopted as before.

Proof: three local preview builds (A0 before the fix, A1 with it, B1 newer), with one of B1's /b/ files held at a
proxy so the new worker's install can't finish, as on Jake's phone.

- **Headless WebKit, the old worker holding its whole generation (PRECACHE).** A0: no pill 10 s after the foreground,
  and the reload boots r50a0. A1: the pill lights 0.5 s after the foreground, and the reload boots r50b1.
- **The iOS Simulator's Home Screen app (iPhone 17 Pro), a real Home and reopen.** A0 under its worker: no pill
  15 s after the foreground, although it read version.json r50b1 and fetched the new sw.js. That is Jake's screen. A1:
  "NEW · RELOAD" 4 s after the foreground. The tap's reload fetched `/` from the network and B1 ran, pill dark.
- Local zones don't reach control without the API (selected-discovery stalls), so in the Simulator the whole-generation
  half is the headless proof's.

The first proof hold, every /b/ and /assets/ file, filled HTTP/1.1's six connections and queued the document behind
them. Staging's HTTP/2 doesn't do that, so the proxy holds one file. The evidence is in
~/.cache/wildshard/plan-artifacts/qa-11-19-row50/.

update-newest-waiting now pins that a third build's discovery keeps the pill lit for it, and that the controller hears
LIVE. pwa-worker-lifecycle pins the network-first reload, its own-build and offline cases.
