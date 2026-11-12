# Desktop layout: the held ready card and the Developer dock (QA rows 11, 13)

Jake, desktop Chrome on staging (about 2576x1230 CSS px), 2026-11-12:
"also lol screen alyout bug" (row 11) and "wheres my dev FPS and dev
memory in staging on desktop lol" (row 13).

- Row 11. With Developer's Hold at loading screen on, the READY card,
  COPY DIAGNOSTICS and PLAY wait for a tap. The held body said
  `align-items: flex-start`, meant for the scroll axis. In a column flex
  box that is the cross axis, so on a desktop the 560 px card and COPY
  sat flush against the left edge while PLAY (outside the body, so a
  phone's PLAY stays pinned under the scroll) sat alone at the bottom
  centre. A phone never showed it: its card is 100% wide. Now, on a
  window 701 px or wider, the body is content-sized with 32 px sides,
  its column is centred, and auto margins on the body and PLAY centre the
  card, COPY and PLAY as one group between the wordmark and the foot.
  index.html's inlined shell CSS was regenerated
  (`scripts/inline-shell-css.mjs`).
- Row 13. The desktop dock (fps line and the memory card) moved on
  11-10 from the top right to 3 px off the bottom edge, in 8 px type, to
  keep off the boss bar. Jake's window clips that: only a sliver showed
  in the bottom-right corner. His grid page still ran an older build,
  with the dock at the top, which is why the dock seemed to move between
  the grid and Driftwood. The dock is one element on `<body>`, so a
  single place is the same in every world. It is now the top-left
  corner, 12 px in, in 10 / 12 px type, wrapping inside a max width that
  stops 36 px short of the boss bar. Nothing else draws there on desktop
  (the chat column stops 120 px from the top; VITALS and coins are
  bottom left; the minimap, quest chip, toasts and the update pill take
  the right). The memory panel drops under it. Phones keep PAUSE's row.
- Guards: `loading-hold.test.ts` reads the real loading.css at 2576x1230
  (card column centred, side padding, the group's auto margins);
  `perf-dock-layout.test.ts` reads perf.css (top-left, not the bottom,
  type 10 px or larger, stops short of the boss bar). happy-dom matches
  neither a media-query list nor `pointer`, so the real boxes are
  checked in Chromium: `hud-worst.mjs --check` now also fails a
  Developer surface that is less than 8 px inside the window, and it
  sets `nameAsked` so the grid card is not stuck behind the first-visit
  name prompt.
