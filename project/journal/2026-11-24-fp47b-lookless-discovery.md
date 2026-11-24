# A discovery with no level look

> Written by: Claude (opus-pr6). Meta FORMAT-PRUNE FP47b, last engine half; after `577c013ef` (the shell reads its product's look).

The next SDK stops copying the level look (sky, atmosphere, grade, horizon) into the discovery document. Before its
product admits, engine reads such a discovery through `shardFromDiscovery`, whose `defineAuthoredShard` gives the plain
look. A preview with Driftwood's and Nine Dragon's discovery stripped (headless, against a control build) found two
readers that still drew it:

- **the page shell** (`gridPageShell`, its selected level, and the world it boots): an owned grid home's shell boots
  before the grid admits its product, and the shell manifest has no shardfile, so the session's own product is absent.
  On the home the region's frame hides it, but on the road (`activeLevel()` with no frame) the whole page drew a
  grey-blue plain look. The session now reads the home's `look/look` straight from its product while it boots
  (`readGridShardfileLook`: the index and one section, hash-verified, no admission, in parallel with the boot), and the
  shell selection re-shapes the shell and its level from it (`GridShellSelection.look`) before the world bootstraps. An
  older product (no `look.level`) reads none and keeps its discovery's look; a failed read does too.
- **a data cell's region** (`regionalWorld.ts`): a non-declared data page's level reads `declaredLevel` too.

`registry.ts` and `clientSource.ts` still configure a level from the discovery before admission; that is the title's
level, replaced by the shell before anything draws.

Proof: `test/fp47b-lookless-discovery.test.ts` (every pinned product: the lookless discovery admits, each reader's look
hashes the same as today's, the shell read from `look/look` equals it, the selection re-shapes and restores), and
shots in meta `project/evidence/format-prune/fp47b/` (lookless against control, within noise).
