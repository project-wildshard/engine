# Browser tests off the hosted path (BROWSER-TESTS-BENCH BB2, BB3, J231)

Jake (J240): agents now wait for their branch's hosted CI before they
fast-forward main, so hosted wall time is landing time. Ring 1's
`build-boot` was the last ring-1 job in 11 of the 12 green push runs
before this (median 377 s, max 403 s; runs 42890089851-42907924242). One
log (42907924242) split it: setup about 35 s, Playwright install 19 s,
`build:ring` 133 s (a `tsc -b` of the layers about 44 s, the spawn
parts' q11 Brotli encode 45 s cold), and the boot 214 s with three
products one after another.

A bench-only branch (run 42913701526, six jobs, since deleted) ran the
build and two boot reps at 1, 2 and 3 boots at once, with full Chromium
and with chromium-headless-shell:

- **The headless shell fails parity.** At one boot at a time it took 80 s
  for the Blender template (27 s on Chromium), and Sunscar missed its
  native-capture deadline. At two or three at a time every case missed
  the title deadline or stalled at `shaders`. So the job keeps
  `channel: 'chromium'` and installs `--no-shell`, which still drops the
  shell download the old `install chromium` also fetched.
- **Concurrent boots buy no wall on 4 vCPUs.** The boot rep took 109-111
  s at 1, 107-113 s at 2, and 101-105 s at 3. SwiftShader is CPU-bound,
  so Sunscar's time to title went from 26 s alone to 73 s beside two
  others, which eats half its deadline. `boot-smoke.mjs --jobs=N` and
  `RING_BOOT_JOBS` stay as a measured option, and the default is 1.
- **The build is where the time was.** `build:ring` drops its
  `tsc -b tsconfig.layers.json`: ring-1's `static` job runs the same
  typecheck on the same tree, and nothing reads `.tsc-layers`. The job
  caches the spawn-part encodings by content (each one is checked against
  its body before use) and prunes those this `dist` doesn't name. Cold,
  the build went from 133 s to 52-57 s; a warm cache skips the ~30 s
  encode as well.
- **The browser installs beside the build:** `ring1.sh build` and `boot`
  are separate stages, and `scripts/ci-browser.sh start` / `wait` wraps
  a detached `playwright install --with-deps --no-shell chromium`, cached
  by Playwright version. In the bench the install (14-23 s) was always
  done before the build; the wait step took 0 s.
- ci's `e2e` job (BB5 allows only this) installs `--only-shell` from a
  cache: both its specs already launched the shell.

BB3: `browser-escape.test.mjs` spent 10.2 s of its 24 s waiting on the
fixture's own 10 s endpoint deadline, and 5.9 s on the delivery case's
5.1 s block. Both clocks run inside their own child process, so those
two children now start in a `beforeAll`, before the warm-up, and their
cases sit last in the file and await them. Nothing in either child reads
the worker's clock, and every assertion is unchanged. On the Mac the
file went from 24.3 s to 10.7 s (three runs each).

J206 Codex review (four MUSTs, all on BB3, all fixed): each early child
now runs the original `spawnSync` inside its own small supervisor
process, so a case that blocks the worker can't stretch the child's
timeout. The native inventory tool is built before the delivery child
starts. `afterAll` waits on the delivery chain, not on a snapshot of
its first child. A filtered run removes the delivery profile it never
checked. SHOULD: `--jobs` is checked before the preview server starts.
