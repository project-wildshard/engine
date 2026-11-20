# The page beacon is armed by the entry itself

buddy-engine, 2026-11-20, QA 11-19 row 19.

`bef3e3273` moved Cloudflare's Web Analytics beacon off the `load`
path: the page was to load it a second after the title or a world
is interactive, so the zone could stop injecting it. On staging
v0.1.57 it never loaded. With the zone's injection off for staging
(a Configuration Rule, `disable_rum`), the Home Screen app, a
headless WebKit tab and a standalone one all reached the title and
never asked for the beacon chunk, so every page view was lost.

A CDP logpoint in Chromium showed why: no `entry` timer at
`ws:ready`, and `start()` never ran. `index.html` loads `entry.ts`
directly; `entry.ts` imports `main.ts` (whose module calls
`start()`) only on the way to a world. The listeners lived in
`start()`, so a launch that stayed on the title never armed them.

`armAnalyticsBeacon(scope)` now holds the listeners (title or world,
whichever is first, once, a second later), and `entry.ts` calls it
as it evaluates. A unit test drives it with fake timers; a wiring
test pins that `index.html` loads `entry.ts`, that `start()` holds no
beacon code, and that the entry arms it at the top level.

The zone rule stays disabled until a release carries this and the
beacon request is seen firing on the host.
