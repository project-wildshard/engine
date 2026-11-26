# The engine stops reading `?chunk=` (opus-chunk2, CHUNK-PARAM-REMOVAL CP22, J522)

- A load boots a world only for a zone it was handed: a tap (the tab's `titleArrival`), Explore's path, a recovery or
  crash record, or the one-cell world a page carries. `bootRoute` now takes that zone, not the address, so with none
  the load is the title. entry.ts keeps the zone in its own `handedZone`; its `search` holds harness settings only.
- An old link (`/?chunk=pine-hollow`, a bookmark) is the plain title: no seat, no modal, and its address is left as it
  came. The retired-slug rewrite and the address side of UNLISTED went with it (a tap can still name an unlisted zone).
- index.html's first paint reads the zone from the tap it took (`homeZone`); the reload helpers (GPU recovery, RELOAD
  HERE, the reload prompt), the crash flag, the entry transport and the seat hop no longer read or strip the param.
- `chunk` left `lint/url-params.json`'s harness list, and the guard's baseline holds no file under `src/` outside the
  tests. e2e proof: `src/e2e/t1/old-link.ts` on the preview build (boot.spec.ts) and the dev world (dev-world.spec.ts).
- test/online-zone-entry-continuation.test.ts fails on main at 0eac3c2f3 as well, before this change.
- Rebased over CP13's last tests (3e4eb2097): title-first-paint now reads the tap as main has it; the old link's
  title is proven by the e2e old-link page, not a unit literal, so the guard's baseline only shrinks.
- Landed by opus-chunk4 (11-26) on main after CP16: the guard's baseline is zero, so it enforces. The parity baselines
  and the phone-loading fixture are recorded runs, read like the calibration reports (skipped); a variable named chunk
  (`(chunk===`, `(chunk=>`) is no longer counted; a test or refusal proving an old link is ignored marks its line
  `chunk-param-guard: old link`. load-mem-probe enters alone; look-loop's test names its zone, not a query.
