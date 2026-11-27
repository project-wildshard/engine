# 2026-11-27 A page with no zone table reads a zone's file from either tier's part (SF11)

With SF11, a zone's files reach a page only from its cook. A zone-table page installs the cook's objects and part members
(PV4) and reads any of them. A page with no zone table (local `build:game`, the dev server, and nightly-heads, whose cold
cooks are baked in by `addStoredShards`) read a zone file past its download from the page origin, where `public/` used to
hold a copy. The batch's headless boots showed it: Nine's normal boot asked for `lab/organic/scroll.png`, Nalati's Explorer
for `baked/cover-boulder-1.webp`, Pine's Explorer for its sky, all 404s.

Every mount is already in one tier's whole-level parts (a phone-only mount in the phone's since cook 1.19.0, any other in
the desktop's), and the page already holds both tiers' whole manifests in its rows (the packs book, or a placed row). So a
cooked zone's `/assets/<slug>/` read now looks in the page tier's part table, then the other tier's, before the network,
and `spawnMountSize` sizes from the same tables. No new cook output: those manifests are the member addresses. A head that
nightly-heads swaps to its cold cook reads the cold cook's manifests, since its rows are the cold cook's.

Guards: `test/spawn-cross-tier-member.test.ts` (a phone page with no zone table reads a desktop-part member, from the cold
row placed over a baked one, never the page or the baked base; a file no part holds still 404s) and
`test/cook-own-sfx.test.ts` (every asset mount of the fence fixture is in one tier's whole set).
