# PAGE-SIZE golden review

PZ24e2 checks final player displacement for every camera, after all
live frames, even when the early slope check never detected a drift.
Non-finite positions fail too. Any camera error now exits nonzero,
including the pre-existing still-on-board error. Receipts and captures
remain available to diagnose the failure.

The native road maps and shared deck grain measured 37 MiB of GPU
textures in Chromium and WebKit on candidate aedd552a, down from 46.
Both engines captured every shard's 24 cameras. The visual review held
the frozen SHARDFILE references, including Nine's historical reflection
difference from LEGACY and Nalati's moving painted cloud shadows.

Pine camera 11 exposed a harness problem: the worker recovered the
posed player back to spawn, while the fixed camera stayed at the den.
Near dressing then vanished despite the network being settled. The
capture now refuses a player that has left a drifted pose. Its solo
still-room option uses the existing practice pause before posing, so
the real local motor and renderer stream around the camera. No world
object is removed. A late pause let a chasing bear cover the view;
pausing before posing kept the camera readable in both engines.

Every other camera retained its existing capture protocol. The exact
Pine recapture is recorded beside the final merged receipt; no golden
reference was promoted. The real grid-road comparison remains separate
because the direct shard cameras do not show the inter-shard road.


Final road proof on d8882b8a: procedural control disables native ASTC;
the candidate uses native sRGB ASTC. Both engines compare a road
approach and an elevated junction view with identical recorded eye
and rotation. Give-way triangles stay on the correct side, repeat
dash phase and ring geometry agree, and no colour or material defect
appears. Labelled boards live in docs/goldens/pagesize-road-*.jpg.
Four road captures per engine have zero page errors.

The final-position audit checked all 288 retained shard camera poses.
Far Reach WebKit 18 ended 4.37 m from its probe; its new d8882b8a solo
still-room repeat passes final residency and both settled fences.
Its green triptych is pushed in shard-sky-reach bce59a9. The other
287 poses pass the stronger final-position rule without a repeat.

The complete branch diff received one Claude review. Both MUSTs are
resolved: real grid-road comparisons are now read in both engines,
and 19ddfc4e pins the release trust root. Material SHOULD findings
were assessed: current road halves have a shared teardown lifetime;
optional surface reads are bounded; every current painter dependency
is hashed. The suggested no-supercompression assertion was declined:
the shipped native ASTC deliberately uses supported Zstd (scheme 2).
The actual post-land solo/offline and memory proofs remain required.


The first landing's six hosted CI shares passed, but main had added
its own shared-chunk reader while they ran. The rebase preserves both:
current builds prefer the exact ownership graph; pre-graph builds
retain the import-map/assets fallback. A current graph that does not
name the build still fails closed instead of reading carried code.
Both reader tests and all 79 focused branch tests pass after the
completed rebase; lint and typecheck are green. No rebase state remains.


The coordinator requested a manual merge against dc847528 after the
second landing stopped on KTX2 conflicts. Both read/decode timing
spans keep their resolved resource names; cancellable reads remain
isolated and late decoded textures are disposed. The diagnostic test
now restores only its own timing global, preserving the shared storage
fixture for subsequent cancellation tests. All 34 KTX2/golden checks,
lint and typecheck passed locally. A final fetch/rebase was current,
with no rebase state remaining, before the one requested land attempt.
