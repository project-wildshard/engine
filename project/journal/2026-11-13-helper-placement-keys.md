# 2026-11-13: the box helper sets the placement pair

- `wildshard-config` takes PLACEMENT_URL, PLACEMENT_PUBLIC_KEY and WORLD_CROSSING (Jake approved 14:52 Cancún; MS3.6,
  SA33/SA35, GC33/GC35). The URL is the channel's own signed file, the key is pinned to `preview-grid.ts`'s, crossing
  is off or worker.
- `set` takes several pairs in one write and one restart, and refuses any state where the server (reading .env, then
  .settings) holds one placement key without the other: main.ts throws on that, which would crash-loop the unit.
- The box copy is root-owned; Jake's sudo installs it, or `wildshard-apply <tag> harden` once a signed release names it.
