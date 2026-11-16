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
