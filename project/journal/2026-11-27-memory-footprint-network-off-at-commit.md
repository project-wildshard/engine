# memory-footprint boots again: Network off at commit only (opus-memfoot, meta QA 11-26 row 71)

- memory-footprint had not measured a green run since 804a8c02c (11-26). From ad1a3ab8b on, every armed WebKit boot
  (brasscap-mesa standalone and online, nine-dragon-stack online) timed out at 180 s with only "Timeout 180000ms
  exceeded"; the green runs in between measured nothing (their ci run archived no client).
- Reproduced on the MacBook from ci run 46089378390's memory-pinned-client: headless WebKit, Node 26 and Node 24 alike.
  The card sat at its first step (`loading`, no `data-step`), no page error, 46 files fetched in the first 0.3 s, then
  nothing: the boot document's module scripts never ran.
- The cause is instrument minimal's `Network.disable` on the warm-up `/version.json` page's inspector session, before the
  boot navigation. Console.disable there boots; no minimise boots (control in about 9 s); Network.disable only after the
  boot document commits (the session the COOP swap opens) boots and keeps the session (`minimal`, not `minimal-lost`).
- So webkitBoot turns the inspector down once, after `bootZone` commits; webkitRung's title rung commits its title page
  before turning Network off, the same way. A source-order test holds both.
- The guard for the next timeout: `untilControl` now names where a stalled boot stopped (its last loading step and when
  it began, the boot-trace checkpoint, page errors, files fetched and the last ones), read from the page itself because
  minimal leaves Playwright no request events. This red took two days to read because the log said nothing.
- With the boots back, the first run on main (memory-footprint 46096480330, `760ab187d`) measured eight armed zones and then
  refused `open-plot-desert-ruin`: "the build's catalogue has 0 cells". Desert Ruin and Thin Ice are armed but off the grid
  (hidden), so `footprintBootFor` sends them standalone, and the standalone boot's one-cell cut (CP12, `alone`) needs a grid
  cell. `bootZone` now passes zone-entry's `unplaced`, which seats an off-grid zone at the origin; a placed zone keeps its
  own cell. A test on `bootZoneEntry` holds it. The stalls had hidden this since CP12: no run reached those zones.
