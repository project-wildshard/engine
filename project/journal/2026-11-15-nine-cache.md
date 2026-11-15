> Written by: Codex
> **State:** in progress, 2026-11-15.

NB11: the CDN cache included the whole release's content-set folder in
every key. Keep content-named parts and hash-versioned assets under a
stable key instead. Bare engine art gets the build's per-file hash;
mutable metadata keeps the release URL. Channel caches stay separate.
Worker fixtures cover changed bytes, retries and unchanged content across
sets. NB1 can now revisit another build while retaining browser caches.
