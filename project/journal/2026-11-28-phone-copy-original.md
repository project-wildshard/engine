# 2026-11-28: a phone copy the cook doesn't ship reads its original

- Meta QA 11-26 row 86, found by opus-qa26 on the ride rig: a page that hears a one-cell world's word takes the one-shard
  flow, and Nalati's phone boot stopped in `level.data` with "props declares
  /assets/nalati-grasslands/tex/meadow.phone.webp but public/assets has no such file".
- Cause: Nalati's ground material names its own phone copy (`texture.phoneUrl`). The cook never ships a hand-made phone
  copy (SF7j): a phone samples the original's KTX2, and the desktop's part holds the original. On a page whose zone comes
  from the cook (staging, production, a rig on a joined build), nothing sizes the copy, so `declareTotals` threw.
- Fix: `sizeDeclaredFiles` (boot/bytes.ts) sizes the declared files as before. A phone copy nothing sizes is declared, and
  from then on read through `phoneUrl` (so `tierUrl` and every loader), as the first original the cook sizes. It rewrites
  the file lists in place, so the audio tables keyed on them stay keyed.
- Proof: test/phone-copy-table.test.ts holds the rule. The stop did not reproduce locally at 71e3ee183: a one-cell Nalati
  rig (PGlite, Chromium headless, iPhone 16 Pro, textures pinned to images) played both phone visits one-shard on a build
  with and without the fix, because a local build carries the zone's files (meadow.phone.webp answered 200). A build
  joined without shard content, as staging's is, never reached the zone on the rig (it waits on entry code), so the
  cook-only page is held by the test, not a rig run.
