# The slow line: first load kept, head bank packed (QA 11-19 row 19)

> Written by: Claude (opus-tr4b8)

Jake's phone on Wi-Fi dropping to 4G (14:15 Cancún): the launch still to 10.45 s, 14 s of white, the title at ~26 s.
Two things in the page made a slow line slower:

- **The 12 s self-reload (RL3) read slow as hung.** A page whose modules had not all arrived in 12 s reloaded, and the
  shell's reload unregisters the service worker first (STALESHELL), so the second load starts every fetch over with no
  worker. 12 s plus a fresh 12 to 14 s load is Jake's ~26 s. The check now defers while any response finished in the last
  4 s (a PerformanceObserver on `resource`), and reloads only after 4 s with nothing arriving: a hung fetch still reloads.
- **The head's module bank was 87% grid entry downloads.** `gridEntryDownloads` spelled every mode (8) and home (24) out:
  640 rows over 50 distinct files, every mode table identical, 738 kB of an 850 kB document ahead of `<body>`. Packed
  (`src/shared/game/grid/entryDownloadsWire.ts`: files once, tables once, modes name a table) it is about 5 kB.

The boot lines also name their step now: the title shell says which file it waits on while loading, not only once
stalled, and the world card's start row ends with its step ("2.5 of 3.1 MB · game code").

Left as is: the service worker's 6 s navigation wait. A worker without its whole generation cannot promise the code its
baked document names, so the network page is the only safe answer; the 6 s binds only when headers take longer.

**The bank leaves the head (coordinator, after the buddy's row 46 proof).** Row 46's dark first bytes (54fb20eaf) alone
left a white screen on the 3G Simulator rig: iOS drops the launch still ~8.5 s after the tap and nothing paints until the
body arrives. `writeBootModules` now writes the bank right ahead of `<script data-loading-clock>`, its first inline reader,
below the title shell; every other reader matches it by id or by regex, not by place.
