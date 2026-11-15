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

NB13: the old texture wait started when a Basis job reached its worker.
File-body reads, decoder initialization, zstd queues and lent paint layers
could precede that wait with no file span. Reads and complete decodes now
have separate file-named diagnostics; the card keeps short progress labels.
Material input/compile phases have their own spans too. No concurrency,
texture format, bytes or upload policy changed.

NB1 --assert-home-spans, capped Chromium, x4, 402x874 @2: Home 5.44 s,
control 15.70 s, largest unnamed interval 0.899 s. The current pin names
13 texture files: three sign textures, two organic textures and eight rig
maps. Each prints its read/decode split. The old phone's 4.6 s cannot be
reproduced on this GPU; a shipped phone paste must confirm that reading.
Twenty-nine focused cases pass, including seven simultaneously pending
body/decode jobs, failure cleanup and an independent gap-coverage oracle.
Main b52607cf CI is the coordinator's explicit prerequisite for landing.
