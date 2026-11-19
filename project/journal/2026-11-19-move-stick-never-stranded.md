# 2026-11-19: the move stick can't be stranded

Lane: buddy-engine (Coordinator P1, QA-FEEDBACK 11-19 row 21).

Jake's iPhone, Driftwood: the stick sat pinned up-left in SPRINT and no touch moved it, just after the
frame meter panel was open over the controls and an app switch. The touch layer holds one pointer per
control (stick, look, attack) until that pointer's pointerup or pointercancel, and a held control
ignores every new finger in its zone. So one lost lift (the page hidden mid-drag, a lost capture, an
overlay over the stick) left `touchMove` and `touchSprint` set for the rest of the session.

`input/touchHolds.ts` tracks the layer's holds and releases them on visibilitychange (hidden), blur,
pagehide, lostpointercapture on the layer, any `app.state` change (the pause menu, Settings) and the
frame meter panel opening or closing (`overlayChanged`). Every new touch also checks the older holds
against `TouchEvent.touches`. A hold with no finger near its last spot is stale and released, and the
press it blocked takes the control at once. WebKit fires pointerdown before touchstart, so holds taken
since the last check belong to the new finger and are not checked; the first cut missed that and
released the new finger's own hold.

`touch-stranded.test.ts` drives the real layer in happy-dom: six of its ten paths failed on main.
`touch-holds-webkit.test.ts` runs the tracker in real WebKit with touch on and WebKit's own
TouchList, TouchEvent and PointerEvent (Playwright's WebKit can't hold a drag, so the page dispatches
them). Main's ci installs Chromium only, so it skips there and is listed with the browser tests.

The touch layer now listens to `app.state`, so `lint/page-events.json` has its row (producer
`app.ts`, proof `local`), as check:page-events (SR12) requires.
