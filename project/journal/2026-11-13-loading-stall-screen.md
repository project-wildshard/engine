# The loading card's RETRY reports itself

SENTRY-TRIAGE S18: report the fault screens that still show, or fix
themselves, without a word to Sentry. The first one is the loading
card's RETRY. A content read that fails past its own retry
(`boot/contentRead.ts` `retryFromCard`) parks on the card's RETRY
until the player taps it. It was the one place that offers RETRY, and
it reported nothing.

It now reports as a new `loading-stall` screen, once per page: the first
read to park on the card reports, and neither the reads that join it nor
another RETRY round while still offline report again (claude -p review
MUST: each round reported, and the outbox keeps only 8, so an offline
player could push out an unsent error-modal). The row asked for a
warning path for common screens, and this is that path.
`WARNING_SCREENS` in `browserErrors.ts` makes `browserErrorLevel` answer
`warning` for any screen it lists. A bad network shows this card often,
so it must never read as an error.

The tags come from a new `engineScreenTags` helper in
`browserErrors.ts`, so engine code outside that file never names the
level field (the engine-words lint). `test/screen-reports.test.ts` walks
it: two reads stalled behind one RETRY, a RETRY that fails again, then
one that lands make one report at warning level. It was red first, with
the report call taken out.

Still owed for S18: the stale-build cover in `browserChunkRecovery.ts`,
`index.html`'s 12 s self-reload, the grid's SAVE FAILED and Shard
Select's UNAVAILABLE.
