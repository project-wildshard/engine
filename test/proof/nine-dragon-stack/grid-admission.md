# Nine Dragon DEVSERVER grid admission (SF51-g, E435)

The descriptor now admits Nine Dragon as a first-party runtime-owned grid product at its stable cell `(1, -1)`. SHARD SELECT retains its native entry. Non-DEVSERVER builds exclude this cell. The resolver accepts only `runtime/index.ts`; it does not widen the trusted-runtime gate.

## Real browser proof

`grid-admission.json` is the unedited Chromium Metal result on isolated candidate `e1b6b0fb005d54c56e88dc6862b9df41f23559bb`, built with `serve-build.sh --devserver`. One muted browser, iPhone 16 Pro, Developer ON, seed 1337, through `scripts/browser-lane.sh`; both contexts closed in `finally`.

- Standalone enters gameplay with the declared Neon Jian on the unchanged `sword` identity and native Fei Zhua LOCK/JUMP actions.
- The grid drives from Driftwood to the road and then along the road to Nine's north midpoint. The only initial pose places the player at Driftwood's exit; entry is held movement, not a teleport.
- The route crosses the prior readiness barrier near world `z=-298.35`, then the cell edge at `z=-305`, and finishes at `(554.980, 0.450, -313.629)`, about 8.6 m inside the deck. Route duration: 56.390 s.
- Nine is the sole resident, `gameplayReady=true`, no pending loads or issues, crossing settled, cell shows `playing`, render origin `(555,-555)`. Its real constructor/world/kit/play/afterPlay hooks all complete; Driftwood is retired. The declared Jian and native grapple are installed. Zero page/console errors or fatal overlay.

This proves product admission, runtime installation and readiness-wall opening on the north entry. It does not claim four-entry traversal, the portal ride, a frame floor, or a native memory result.

## Geometry audit

No geometry was changed. `world/entries.ts` already supplies four road-height decks, 8 m clear openings and 16 m depth. The existing real collider contract samples the complete 8 x 15 m socket of every edge at 0.25 m spacing, proving top height y=0 and side walls outside the opening. Grid decks omit standalone caps. G224 portals at 14 m provide the route to the elevated fragment. No missing midpoint geometry was found for an Opus handoff.

## Validation

Focused admission/plugin/runtime-row checks pass (12/12). Root strict, root-config typed lint and ratchet pass. The first clean full suite exposed the final legacy-cell fixture assumption: it passed an empty list to a deliberately nonempty-only edge reader. The companion fixture now skips that call when all cells are declared and explicitly checks that Nine is not a legacy fallback. Final fresh clean-export full suite: 961 files, 5456 tests passed, 14 skipped (167.61 s, heavy-lane ticket 498). Mandatory precommit and commit-message hooks pass.

No map-hash input changed; no map rebake or graph increase is required. The previous SF51-p blocked approach remains preserved in `runtime-owner.json` and is superseded only for this admission claim by the new real route.
