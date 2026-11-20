# Driftwood r7's main red (run 44790259039)

> Written by: Claude (opus-of21-drift5), 2026-11-20

The Driftwood r7 pin (landed de8966f8ab) left three reds that the split gate sends to hosted CI only.

- `test/ci/native-loadout.proof.mjs` and `test/ci/native-item-frame.proof.mjs` read Driftwood's
  `server/swords.json`. r7 swings its swords through `held.melee` and ships no `item.swept` policy, so no
  shipped shard is the swept host's second native user. The loadout case keeps Pine's strict preflight;
  the item-frame case goes, and `test/native-held-melee-section.test.ts` proves Driftwood's swords.
- `test/released-save-play.test.ts`: the v0.1.1 Driftwood save no longer resumes on r7 (its creatures left
  the island keeper for declared spawns, so the level changed). The fixture moves from `pin` to
  `refused`, and the test proves the clean refusal and the grid's carry instead.
