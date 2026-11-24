# Pastel Plain and Ink Cel Valley leave the tests (ZONE-SNAPSHOTS ZS7, first half)

> Written by: Claude (lane opus-snap). 2026-11-24.

J493 took both zones off the grid; J507 says no old zone snapshots in tests. Deleted by hand, nothing unique lost (each
was a pinned API product or a capture of one; git history keeps the bytes):

- `test/fixtures/retired-grid-products.json` (the two frozen pins) and everything that installed them: `pins.ts install
  --for-tests`, `readBuiltShardfile`'s `testFixture` branch and `out/.test-products`, the push-gate copy's proof pins,
  ci-pack's phase-2 install, `test:fast`, nightly's two installs, and `pin-test-names`' frozen-slug exemption.
- `test/proof/{ink-cel-valley,pastel-plain}`, `test/ink-native-proof.test.ts`, `test/fixtures/pastelSource.ts` and the
  six m5 parity baselines of the two zones.
- `test/script-seats.test.ts`: its four cases need an item with a script hook and an interaction that turns a public
  field (Pastel's whip and door). No live pin has either, so the cases go with the zone; a live shard that ships a
  hooked item can bring them back.
- `declared-kit-tape`'s Pastel whip case (Brasscap's lever case stays).

Moved to live pins: the lone-cell walk reads Mossgate (pinned, on no grid cell); the data-cell saves, refused saves and
net-fuzz's data worker read Open Plot Thin Ice. Label-only tests use made-up names.

`pins.ts status` now lists cache tarballs no pin or slice names, with the command that removes them; it deletes
nothing (J358).

Left for the second half, after ZS11 moves the API's stale channel pointers and finalizes the two: `zoneSelectRows`'
`OFF_PLAYER_LISTS` (and `dedicated-zone-select`'s row 26 case on it), `shard-public`'s `GATHERED_SHARDS`, the generated
boot publication and manifest closure, the memory and grid-crossing ratchets, `check-platform-ratchets`' exemptions,
`worker-client-play`'s Pastel door step and the guard's own `RETIRED` list.
