# 2026-11-16: `wildshard prepare` enters an inline hybrid (mini-nineprep)

Meta NINE-DRAGON-BENCHMAX NB19, mini QA 11-16 row 42.

- Nine Dragon never prepared: its inline candidate declares a runtime and `installShardfileProduct` refuses every
  runtime ("Custom runtime requires trusted hybrid composition"). The live game admits Nine by its discovery's
  client-plan entry (`planEntry`), first-party, with `gridShardfile` naming its own descriptor; the runtime is data.
- The page that owns its inline candidate (DEVSERVER / PREPARATION_ONLY) now reads the candidate's discovery and enters
  it as a catalogue arrival (`inlineRuntimeArrival`, `selectInlineRuntime`, entry.ts). The bare inline path still refuses
  any runtime, so does every released page; the discovery must name the client-plan entry, the same identity and its own
  same-origin descriptor.
- Second gap: the in-page server read `server/` files only from the build's server book (the pinned revision's packs,
  dropped from the preparation archive). For the owned candidate's slug only, it now reads them beside the candidate,
  still hash-verified (`ownServer`).
- Proof (Mac mini, headless Chromium for WebKit): Nine `ca191b3` prepares in 8 s (69 programs, fence 457), builds 114.6
  MB. Still outside engine: the candidate's cook mounts lack `/assets/nine-dragon/lab/organic/leaf-atlas.webp` and
  `/assets/nine-dragon/lab/grapple/dragon-hook.glb` (their GPU twins are mounted; the phone page reads the originals);
  the proof served those two from the client folder.
