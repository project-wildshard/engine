# The cook worker polls the catalogue (SHARD-COMPAT SP6a, buddy-engine)

- opus-ss16f, 04:06 UTC: a new upload never cooked on the box until the
  cook restarted. The API sends the box no notice (MMO_NOTIFY_URL is
  unset), and the worker listed the catalogue only at boot.
- J175 had already decided the fix: "the cook worker polls outbound, no
  API call into the VPS". SP6 names an R2 change file and J275 an API
  notice plus KV, but neither exists today. The smallest thing that does
  exist is `GET /api/catalogue`, which the boot list already reads, so
  the poll reads that.
- `CookWorker.sweep(stages)` reads the catalogue once and cooks, in the
  worker's one queue, each upload this process has not settled. Cooked,
  present and refused uploads are settled. A failed one waits 10 min,
  doubling per failure up to 6 h, so a broken file isn't cooked again
  every 45 s.
- `pollCatalogue(worker)` sweeps every 45 s (COOK_POLL_SECONDS, clamped
  to 30-60). Each catalogue error in a row doubles the wait, up to 10
  min. `serve` starts it after the boot list.
- Test first (`test/cook-worker-poll.test.ts`, red on
  `sweep is not a function`): a real cook of sunscar-dunes appears on
  the next sweep, an unchanged catalogue downloads nothing, a failed
  upload waits out its backoff, and the poll's waits follow 1, 2, 4,
  cap, then back to 1.
- Left open as SP6b: J275's notice plus KV, "stale shows unpromotable"
  and "notify gone".
