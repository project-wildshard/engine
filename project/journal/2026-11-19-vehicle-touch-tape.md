# 2026-11-19: the vehicle touch tape (MSZ12b)

> Written by: Claude (opus-mirrorsalt-m7, meta MIRROR-SALT-ZONE MSZ12b)

`scripts/parity/vehicle-touch.mjs` drives Mirror Salt's yard buggy by touch on phone WebKit against a local `wildshard dev`
world: the USE band takes the seat, the move stick and BOOST drive it 20 m, BRAKE brings the gauge to N, LEAVE gets out.
It ran green on the first build it reached, 21.6 m in 2.2 s and a stop in 1.3 s.

The shots it takes failed a blind board twice before passing on the third round, and every failure was real:

- the held sword stayed in the seat's view. `equipment.stowed` only lowers it, and lowered it still crossed a portrait
  phone's windscreen; the seat now also hides it, as a creature mount's rider's does (`pageFacets.ts`);
- the gauge could not be read: the lit gear was cyan on a translucent chip over a red bonnet. A seated gauge now stands on
  the deep glass, lights its gear as a filled pill and shows km/h (0 at N);
- the raised gauge then sat on the HORN and BOOST discs: a seated gauge stands 26 px higher on a phone, and its hint reads
  *Tap for chase view*.

Two findings for whoever comes next: a vehicle dock's prompt is reached from the eye (1.68 m up) to its ground spot, so a
walker must stand within about 1.8 m of the dock's centre; and a first visit's mic tip sits over the gauge's left end on a
portrait phone (the tape closes it, as a player would).

Running it needs sharddev's own `wildshard dev` (the npm CLI 0.4.12 runs no world, so the page says no server is
configured) on the packed engine: an `--import` resolve hook maps `@wildshard/engine` to the shard's override.
