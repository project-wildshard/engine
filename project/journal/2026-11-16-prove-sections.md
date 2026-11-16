# `wildshard prove` can admit v1 decisions (TC-NE5b, buddy-engine)

- opus-brassgun13, QA-FEEDBACK 2026-11-16 row 18:
  `proveAuthorSimulation` built its worker with no `sections`.
  sharddev's checked product carries no engine output descriptor, so the
  worker admitted every Wasm as ABI 0, and the reference world's boss
  decision failed `Import signature outside ABI` before any tape ran.
- `proveAuthorSimulation` now takes the sections as an optional fourth
  argument, passed through the same way `validateSimulation` does.
  Without them nothing changes.
- Test beside "SDK worker executes the declared v1 section": the same
  frozen v1 product is refused under ABI 0 without sections (this
  fixture trips the missing `abi_version` export, the reference trips
  the import check). With the sections it runs the tape and stops only
  at the plan's never-filed fact.
- Left for sharddev, once the sdk pins this engine: `cli.ts` prove and
  `checkProject.ts` pass `checked.sections`. The end-to-end check on the
  built reference (load, the restore check, then only the tape's missing
  fact) belongs to that change.
