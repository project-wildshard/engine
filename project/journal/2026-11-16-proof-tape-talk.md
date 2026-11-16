# Proof tapes talk, answer and check the pack

> Written by: Claude (opus-ss16l), 2026-11-16. Meta NEW-SHARD-E2E F27, MINI-UNBLOCK MU6.

The Mac mini's outside-author run (Honeyknoll) wrote a proof tape that talks to its quest-giver, Wren. `wildshard prove`
refused it at once: `Unknown authored interaction`, with no tick, no id and no list of what a tape may name. A tape's
`interact` reached only `targets.interactions`; a `targets.talks` row and its dialogue answers were not addressable, and
the report had no inventory to check the quest's loot against.

- `interact` with a talk's id is E on that talk: it closes a node with no choices and opens one with choices.
  `<talk>:<choice>` answers the node the player stands at. Both land on the claims the page's own presses use
  (`talk:<talk>.<node>.<choice>`, `declaredTalks.ts`), so the server judges reach and the node as it does for a player.
  `talkPress.ts` resolves the names.
- An id that names nothing refuses with the targets it could have named; an answer the node doesn't offer names the ones
  it does; in an author proof each refusal starts `tape tick <n>:`.
- The report carries `inventory`: every native pack's stacks when the tape ends, by pack id (`nativeInventories`). A plan's
  optional `requiredItems` (item to at least this many, summed over packs) fails the proof with what the packs hold.

Tests: `test/tape-talk.test.ts` (TE-ENG3's keeper fixture, by name), `test/author-proof-inventory.test.ts`.

## Later the same morning: the proof itself refused every real shard

opus-ssne1's minimal scene shard (`meadow`, one quest fact) failed `prove` on a two-tick stand-still tape. Two engine
faults, both in `proveAuthoredGrid`:

- **"traveler pose changed on restore".** The check compared the pose after re-entry with the pose at the checkpoint, but
  the traveler spends the five frozen ticks on the highway, which moves it as any tick does: a body on a slope creeps
  (0.05 mm a tick on meadow's knoll), a walking one walks. It now compares with the pose the highway hands back, exactly.
- **"Fact identity or provenance is not admitted".** The proof filed every quest fact under origin `quest:<id>`; every
  shard's ledger rule says `quest.complete`, and a fact with no rule has no mapping at all. It now files a fact under its
  rule's own origin, as `grid/durability.ts` does, files none for a fact no rule rewards, and checks `requiredFacts`
  against the facts the quests raised.

A diverged restored suffix now names the first differing path. Proof: the meadow tape and a walk to its hut pass.
