# Use the existing bundler for the remaining callers

NM4 found esbuild's native binary in the real dependency tree.
Vite already installed Rolldown, so that was duplicate build weight.
The six direct callers now use a pinned Rolldown API.
The service-worker emitter owns and closes an async bundle.
Both application and author catalogue callers await its completion.
The author SDK accepts await with its older synchronous engine too.

The kit production build and development watcher keep main.js.
Development writes an initial build before admitting HTTP traffic.
Subsequent changes use the native Rolldown watcher.
The native epoch proof supplies its inline entry through a loader.
The native fence proof bundles the real exported fence implementation.
Its root option permits the proof against an owned finished build.

The worker lifecycle fixture bundles once per file, not every load.
Its execution and cache assertions stay intact.
The emitter checks accept const as well as var declarations.
Actual generated worker bytes still determine the core URL and build.
No worker caching, clock, ownership or gameplay code changes here.

Before removal, the existing 41 PWA cases passed with esbuild.
After migration, all 41 passed in 0.818 seconds.
The production kit build and real Chromium smoke passed.
The dev server served its health endpoint and actual main.js.
The actual epoch proof passed four cases across Chromium and WebKit.
Native WebGL fence lifecycle proof passed seven cases per browser.
All 28 pinned products admitted and the app built in 22.22 seconds.
The emitted worker completed an actual controlled Chromium boot.

pnpm why esbuild now prints nothing after a normal prune.
The project store shrank from 353116 to 342604 KiB.
Build bytes change because the bundler preserves const declarations.
Existing worker execution and native browser proofs review that delta.
No test was added to a hook and no deadline was raised.
Engine publication remains held for the release owner's v0.1.2 gate.
