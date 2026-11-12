# Rope decks on the room (NET-LAG NL5)

- Jake: "i fucking clipped through the rope bridge because of the lag lol".
  Not prediction: the room built no rope chain. The page builds Driftwood's
  span from its `client/plan` rope-chain stage and stands the player on it;
  the room's resident (`createTrustedHeadlessResident`, what `cellWorld`
  runs) never did, so the server's player walked on air over the gully,
  fell to its floor (y -0.89 at mid-span), and the page's next correction
  pulled the player down through the planks. Test walks hid it: the proof
  fixture `test/fixtures/headless/ropeBodies.ts` installed the chain.
- `src/server/host/ropeDecks.ts` builds the same chain on the room from the
  same stages. A restore installs on a fresh world and swaps the saved one
  in after, so a `joined` adapter's `physicsRestored` lends the saved
  bodies back as rideable, or builds them for a room saved before this.
- Room walk over the bridge, 20 each way: 20/20 into the gully before,
  0/20 after. The page's half holds: with a chain on both sides a crossing
  needs no correction, and a correction writing the server's feet 0.3 or
  1 m under the planks replays back onto them (`net-predict-deck`).
- Second commit: `test/net-predict-deck.test.ts` keeps the page half pinned
  (real Player and PlayerSim, a rope chain on each side, delays 3/6/9).
- Review folds (one-shot `claude -p`, no MUST): one owner per rope deck or
  refuse (a saved chain is found by owner); the room that came back from a
  save walks the bridge; comments on the sections path and the test span.
