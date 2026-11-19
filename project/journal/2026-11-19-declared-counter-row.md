# 2026-11-19: a declared counter says what it counts

Lane: buddy-engine (Coordinator, QA-FEEDBACK 11-19 row 28, its second half).

Jake, Mossgate on his iPhone (screenshot c4664087): "the vitals bar is a blank white bar with no heart
or number". It was not the vitals strip. Mossgate is built on the Template, whose `ui` section declares
a counter: LANTERN OIL, band.3, the lantern's oil from 0 to 1. `mountDeclaredHud` drew a counter as a
bare `<meter>` with its name only in `aria-label`, and iOS paints an unstyled meter as its own
grey-white bar. That bar, in the row's glass frame, is exactly what the screenshot shows. Rendered in
WebKit at phone width with the real stylesheets, the old markup gives the same blank bar.

A counter is now a status row like VITALS: its label, the HUD's thin cyan bar and its value (a percent
for a 0-to-1 span, otherwise `n / max`), refreshed each late frame from the declared field. The
`<meter>` stays in the row, out of sight, as the value for assistive tech and the handle tests and
bindings read. Tests: declared-counter-row (4, all red on main); the 54 test files that depend on
declared.ts pass.

Earlier today I had ruled the counter out for Glowfen, whose source declares none. Mossgate's comes from
the Template.

[J249 follow-up] The row's classes use the `ws-touch-` prefix owned by `touch.css`.
This fixes the static failure in run `44593656749` and keeps the row's display and native meter.
