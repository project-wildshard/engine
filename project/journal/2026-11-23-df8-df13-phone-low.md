# DF13 meter and DF8 program slots at phone Low (mini-dwfps2)

- Judged on the calibrated stand-in (DF3: headless Chromium, phone Low, cap 30, CPU 2.0x = the iPhone 13's update and
  render p50 on `aaeec2602`), on a local `serve-local --public --no-watch --shard driftwood-isle` build.
- DF13: the dock's update p50 is 2.4 to 2.7 ms on main `44779755c` (three cold dock boots), inside the 3.0 ms line. The
  meter's REC still showed `other 1.8` with no part listed, because the line printed only parts of 0.3 ms or more and
  every part was smaller. The other line now lists the largest parts (0.1 ms or more, at most eight), sums the rest and
  names what no part claims as `unnamed` (`ui/perfHud.ts` `namedUpdateParts`).
- DF8: with `debug.programReuse` and `debug.programFold` the driftwood-fps route went from 173 to 122 programs and from
  42 to 4 links after control (none at draw: the four are the road warm-up's compiles in the first five seconds).
  `debug.bootRoadPrograms` moves those under the card. All three now default on at phone Low; a saved pick still wins,
  and other tiers keep them off.
- The last four links after control were the outer far ring's first proxies (`sf23-far-pbr`, `-pbr-position`,
  `-painterly`) and the haze band, prepared 4 to 5 s in because the ring starts once the background opens. The boot's
  whole-inventory warm-up now links one stand-in of each far variant and a band under the card
  (`GridSession.warmFarRingPrograms` through `Game.warmRootsNow`; the host's `prepareView` waits for drawn frames, so a
  first try through it compiled the stand-ins after control). Route census: 0 links after control, 122 programs.
