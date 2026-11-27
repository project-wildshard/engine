# Pins install publishes nothing under public/ (SF11)

Lane opus-public, meta standalone shardfiles SF11 (J525). A zone's art
lives only in its shardfile, and since fix preview PV4 the page reads every
zone from the cook, which reads a zone's mounts from the shardfile itself.
So `pins.ts install` stops copying each pin's mounts and `cook.json` mount
rows to `public/` (97 MB of shardfile blobs the build used to publish
again): it writes `out/<folder>` and nothing else.

An install removes what an earlier one published (the ledger
`out/.pins.json` names it) and clears the `info/exclude` lines, so a
checkout that pulls this change sheds its old copies on the next install.
The `.gitignore` pin-output block goes with them, and so does
`src/test/pins-ignore.test.mjs`, which guarded it. The pins reuse key
moves to `pins-reuse/4`, so no tree reuses a manifest that still lists
mounts.

The guard is `src/scripts/pin-public-leaks.mjs`: it hashes every pinned
product's blobs (named by their SHA-256) and asset mounts, and fails on a
ledger row, an untracked `public/` file or a `dist/` file holding those
bytes. A zoneless build runs it after `checkZoneless`;
`test/pin-public-leaks.test.ts` proves it on made-up trees and on a real
install of the smallest open plot by slug.

One reader of the published mounts was the build's boot audio: the cook's
boot set filters by the page's byte table, which only knew a zone's
recordings because its pin published them. `withShardMounts` adds the
shard's own mounts (bytes, music and sfx manifests) to those tables for its
own selection, as the client's `adoptInlineMounts` does, and the boot audio
test reads them the same way.

Two engine-list files reached `public/` only through a pin: the cloud
field (Nalati's mount) and the water ripples, read on every zone
(`bakedUrls.ts`). They are now tracked engine files (256 KB each), and the
test fails if any file on `public-engine.json` is not in engine git.

Built ahead on top of SF10 (the art fetch from shard repos): it lands when
every build is zoneless, after SF5 to SF8 are pinned.
