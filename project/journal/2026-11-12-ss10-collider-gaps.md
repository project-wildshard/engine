# 2026-11-12: SS10 collider gaps

- SERVER-PARITY SS10 (meta plan), lane opus-ss10. SS1's side-parity diff
  had five shard gaps pinned under SS10; three close in engine:
  - A lone native cell added `addEdgeWalls` over a bake that already held
    the same four walls: Pine had eight, Nalati four untagged copies that
    block rays. `addEdgeWalls(physics, { reuse: true })` keeps the baked
    cuboid (untagged, enabled, solid, WORLD groups) and tags it `edge`.
  - Nine Dragon's 16 standalone deck caps lie inside the server's edge
    walls, so the room already blocks that space. The diff treats a static
    page solid inside a server `edge` wall as covered.
  - Pine's three owner names are declared in `side-parity.allow.json`
    `same` with reasons. The aliases are fallbacks only (own name first, one
    to one, same material and shape), and a stale alias fails the test.
- Still open: Nalati's bake is a frozen capture (155 spruces where the page
  now places 146 at other heights, no owner or material on any solid), so
  it needs a re-captured, tagged bake, a Nalati upload and a re-pin.
  Wendell's page body sits at the origin: his figure row anchors the
  scene root, and the rig moves the `figure` part. Resolving each world
  position in `FigureRows` did not move it.
