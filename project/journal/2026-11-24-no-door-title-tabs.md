> Written by: Claude (opus-grid)

# 2026-11-24: a title with no door answer keeps every card on its tabs

Main ci 45298253323 went red in `boundaries` (cook-to-play): Brasscap Mesa's boot smoke lost its page under the gameplay
wait. `3ce1ca5da` (QA 11-23-b row 26) took Developer-only cards off Featured, Popular and New even when no door
answered. Brasscap's cooked status is `hidden`, so the preview title deck, booted by `?chunk=brasscap-mesa`, no longer held
its card; ENTER entered Signal Dunes and the page navigated. Not `f9bc3808a`: a preview page reads no placement file.

Fix: `zoneTabs` with no served document (preview, solo, a standalone `?chunk=` boot) returns the build's own cards on
every tab, as before row 26. A served document still keeps hidden and test shards off the player tabs. Test:
`main-menu-deck.test.ts` (red before, green after).
