# Both rooms hosts 521 for an hour; the release now reads them (opus-rel86, FAST-RELEASE FR-A15)

- At 10:11 UTC Caddy, the one proxy in front of both channels' rooms, rolled its 50 MiB access log. lumberjack's roll and
  the gzip after it chown the new file, and harden's `SystemCallFilter=~@privileged` holds @chown, so the kernel killed
  Caddy (SIGSYS); each restart died again 2 s in on the gzip. `3cce867c4` lets Caddy chown.
- v0.1.88's staging checks passed through that hour because every release gate reads the tailnet. A staging or
  production release now reads both public /up URLs before the check, after the cook and harden, and after the alias,
  and stops on anything but 200; ALLOW_ROOMS_DOWN=1 is the escape for a release that fixes an outage (J381).
- test/vps-harden.test.ts renders each drop-in harden-apply.sh writes (server, cook, Caddy), applies its SystemCallFilter
  lines in systemd's order, and holds every syscall group the service is known to call allowed (CALLS; Caddy's @chown for
  the log roll). A new call goes into CALLS, so the filter changes before a box kills the service.
- scripts/rooms-watch.mjs is the outside alarm that reaches an agent: Sentry's uptime monitor did raise WILDSHARD-GAME-86 at
  10:13, but its rules only mail Jake and no agent polls Sentry. Every 60 s (a LaunchAgent, `--install`) it reads both
  rooms /up URLs and, with a Sentry token, the open outage issues; two failed reads or a new outage issue give one
  `NOTE RED builder:` receipt and an hc send to the builder. The disabled Sentry monitors stay off (one free seat).

# The box cook OOM-killed at 4G (opus-rel86, 11-25)

- After v0.1.88's cook move the cook was OOM-killed at 11:00, 11:27 and 12:07 UTC, mid-Nalati, once a full bucket
  listing (about 1M objects) overlapped a cook. Each regex-captured key kept its listing page alive (370 MiB for 1M rows,
  173 MiB with fresh keys), and each publish copied and split the whole listing to measure usage. packStore copies keys;
  a publish sums cook bytes straight from the map; test/cook-listing-memory.test.ts caps a row at 260 bytes of heap.
- The cook alone peaked 3.9G before any prefetch, so the fix alone can't hold 4G: harden's cook MemoryMax 4G -> 5G.

## FR-A17: production waits for every zone's packs (QA 11-25 row 35)

- Row 35's reload loop (fixed in the client by ee1bef52a, after v0.1.90's cut) fires when a zone has no packs for the
  page's build. Production check and go-live now read every head production's catalogue advertises and refuse while
  any `index/<build>/<hash>.json` is not 200 with play's Origin (ALLOW_MISSING_PACKS=1 is the J381 hatch).
- Live read 13:3x UTC: prod's own v0.1.85 build has all 27 heads (no false refusal); v0.1.89 lacks pine-hollow and
  sunscar-dunes (cooks the OOMs cut short); v0.1.90 lacks 26 while the cook recooks for its new cook revision.
- v0.1.90's release clone predates the gate, so its promotion runs `node scripts/page-release/production-packs.mjs
  <build>` from main first.

## FR-A19: staging QA waits for the recook

- v0.1.89 and v0.1.90 both held at staging QA on 404 packs: each toured while the cook recooked every head for the new
  build. `deployStaging` now waits, at most 45 min, until every head staging advertises has its exact-build index, and
  holds with the missing heads named after that (`waitForPacks`, the same read as FR-A17's production gate).

## FR-A20: the cook takes advertised heads first

- After v0.1.90's cook move an old pine-hollow upload no catalogue advertised (65b0e6ff, counted as new because no build
  had indexed it) cooked 849 s ahead of 37 recooks; Brasscap r19, which staging QA needed, sat 33rd. The queue now
  takes an advertised head no build has indexed (a new pin), then advertised heads in catalogue order, then a bare upload
  notice no catalogue advertises, last.

## Release-proof bots outlive their lane (QA 11-24 row 5)

- opus-tail's three --release-proof bots held their seats to 12:20 UTC, then ended between 12:20 and 12:50 UTC with no
  countdown, report or cleanup-log kill: most likely SIGHUP when opus-tail's shell exited at its 12:29 handoff. Now
  --release-proof ignores SIGHUP, runs the bots in their own process group, logs any signal or exit to run.log, and the
  usage says to start it under `nohup` (macOS has no setsid).

## A gh hiccup no longer holds a train (QA 11-25 row 7)

- v0.1.91's train held at 15:48 UTC on one failed `gh run` read (quota 2,756 of 5,000, release CI queued), with the
  local QA leg already passed. The train's `gh list` and `gh view` reads now get three tries 5 s apart (retryRead);
  uploads and workflow runs still happen once.

## Release-proof riders leave the observer its sockets (v0.1.91 P2)

- v0.1.91's staging MMO observer reported `baseline-reconnect-budget`: its second baseline bot failed 5 joins. The door
  seats 4 sockets per address, and the 3 release-proof riders plus the observer's 2 bots all came from this Mac. Riders
  now default to 2 and refuse more than 4 minus the observer's 2.
- v0.1.93's npm next would have waited out v0.1.92's whole staging leg: the train dispatched npm next only after a staging
  candidate passed, though npm-publish.yml admits it on the exact green release CI (J475). The train now sends npm next
  on that admission when staging is busy, and every `gh --commit` it passes must be a full SHA (a short one matched no
  run and held a wait 20 minutes past a green ci).
- v0.1.93's prepare stopped once because its push gate saw the shared install move mid-gate (a land refreshed it). The
  train now prepares once more on exactly that stop; repo-kit rolls back the half-made branch, so the retry starts clean.
