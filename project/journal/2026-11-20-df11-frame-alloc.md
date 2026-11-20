# DF11: the dock's per-frame allocation (mini-df11)

- Chromium 3x, phone Low, 30 cap, 30 s turning dock leg, V8 sampling at 16 KiB with collected objects, source-mapped.
  Base 1.00 to 1.14 MB a frame. Road construction beside play is 0.40 to 0.48 of it; scene.updateMatrixWorld 0.09;
  the wire, render submit, parsed-page decode and the worker next.
- borderShimmer and nearColliders made garbage every step (11 and 8 KB a frame): the panel search scored four
  candidate objects per cell, the collider list was copied each step. Both now work in place, no behaviour change.
- Road build: the bin and clip loops index plain attributes' arrays (checked after every pause, three's getters
  otherwise, so the anchored live-read, spied-getter and golden-hash tests hold); the LOD clusterer's Map of boxed
  double keys is a typed open-addressed table (LodFirsts); a solid part's bounding sphere is read from its Float32
  array (bit-equal to three's); streetlight copies go straight into typed arrays. Candidate A (most of this) took
  the dock from 1.14/1.03 to 0.85/0.86 MB a frame, road build 483 to 262 KB.
- Not yet cut: scene.updateMatrixWorld allocates about 25 KB a call, all under the `creature-warm` group (348
  nodes); a fresh 750-node tree in node allocates nothing, so something on those nodes (an accessor or a patched
  method) boxes. The next owner should read that group's nodes first.

## mini-df11b (relay 2)

- The `creature-warm` walk: nothing on those nodes is patched. three's `updateMatrix` itself boxes about 72 B a
  call in the page's V8 (a fresh Bone chain does too); the warm group is 348 of the scene's nodes and nothing poses
  it, so its matrices are composed once at staging and its auto update is off (24 of the walk's 28 KB a call).
- The portable sin/cos stored the reduction's hi/lo in two module `let`s: two heap numbers a call. A Float64Array
  slot now.
- Road draw: the cull hook copied and moved a Sphere per bin per draw (33 KB a frame); it now keeps each bin's world
  sphere while the mesh's matrix holds and tests the frustum planes with plain numbers (three's arithmetic).
- Generators: a loop that pauses inside a generator, or runs once a build, keeps its doubles boxed in V8 (measured in
  node: a resumed loop's running min/max boxes each step; a plain chunk function does not). cullPlanSteps' bin, bounds
  and radius loops and the seam merge's per-strip vertex loop now run in plain functions between the same pauses.
- Parsed-page decode defined every key with a fresh descriptor object; a plain store makes the same own property,
  so only `__proto__` is still defined. The road look's Mesher grows typed arrays instead of number lists.
- V8 shapes that box: Math.hypot (installed portable) took a rest array per call; a sort comparator returning `a.d - b.d`
  boxed every difference (the ring planner, 35 KB a frame); vertexPack's encode loop with a `continue` and nested
  ternary boxed 48 B a vertex even hot (node). hypot takes up to four plain arguments, comparators return -1/0/1, the
  encode loop is branch-light; all bit-equal.

- mini-df11c: an undrawable wire row (another cell's creature) no longer throws and copies the species lists every frame; findSpecies and a per-scope miss cache answer it, and its fields are read only after its kind is drawable (~20 KB a dock frame).
- mini-df11c: road tile decode checks positions with an indexed loop (a for-of over the Float32Array boxed every component), and a far proxy poses its positions and normals straight from their arrays with three's arithmetic in three's order (test/far-pose-bits.test.ts holds it bit-equal to applyMatrix4).
- mini-df11c: portable sin and cos returned a fresh heap number per call where not inlined (~12 KB a dock frame, mostly the ambient flyers and the posed draw's setFromEuler); sinTo/cosTo write the same bits into a typed slot. The far pose also computes three's box and sphere straight from the array.
- mini-df11c: the page bundles portableMath twice, so sinTo's identity check fell back to Math.sin; a shared Symbol.for mark lets either copy use its slot kernel. The flock's scratch points are a class, not shared { x, y, z } literals.
- mini-df11c: the rope chain's capture passes held targets to Rapier's translation and rotation (12 KB a dock frame of fresh vectors).

- mini-df11d: the tile streamer's plan stops allocating. Some dock runs never settled the idle plan and replanned every
  frame (+0.08 MB a frame). Replanning only on input changes would move the lease distances the allocator ranks by, so
  the plan stays per step and reuses its rows, lists and sorts instead: 127 KB to 11 KB a replanning step in the node
  bench, with the 115,894-line residency trace unchanged (pinned in tile-streamer.test.ts).
