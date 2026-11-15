> Written by: Codex
> **State:** in progress, 2026-11-15.

NB11: the CDN cache included the whole release's content-set folder in
every key. Keep content-named parts and hash-versioned assets under a
stable key instead. Bare engine art gets the build's per-file hash;
mutable metadata keeps the release URL. Channel caches stay separate.
Worker fixtures cover changed bytes, retries and unchanged content across
sets. NB1 can now revisit another build while retaining browser caches.

NB11 proof: local builds ninecache-a / ninecache-b, different content-set
folders, CPU x4, 402x874 @2, capped: cold 42 parts / 12 phone paint
requests; warm 0 / 0. Control 19.95 / 17.67 s. All 64 worker/emitter
cases pass; types, lint and sides pass.

NB12: only the home's far coverage may start during boot. Adjacent cells
now join the existing post-control gate. NB1 before: 42 neighbour runtime
requests before control; after: zero on both cold runs (15.74 / 17.20 s
to control). The repeat observes 195 neighbour runtime requests after
control, starting 1.35 s later, so they resume normally. Discovery cards
remain boot metadata. Local home is noisy (5.33-6.04 s); this makes no
phone speed claim. Nine grid/background/control tests pass (9 cases).
