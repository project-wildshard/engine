# One actual-host senses observation

> Written by: Codex
> State: foundation locally proved, 2026-11-17; ONE-FORMAT CC44a.

Published format17 already defines notice, sight(range/cone/graze),
hearing(still/crouch/walk/sprint) and reveal. No defining change or
package pin is required. bindCreatureSenses is a two-method server
observation owner: notices an actual host player and picks the nearest
one it notices. It allocates no controller/body/clock, registers no
adapter/callback and never draws RNG. Its two sight vectors are reused.

A radius remains the default visual sense. Authored sight replaces that
visual test with actual heading/range and the existing world LOS query;
hearing adds independent detection by actual horizontal velocity and
the native still/crouch/walk/sprint thresholds. Reveal is omnidirectional.
Parked/dead/foreign seats cannot supply a target. Omitted senses retain
the actual native nearest-player selection. The native controller still
owns its action ranges, cooldown, target continuation and strike/body.
Native hunt grazing/awareness remains CC44c's existing HuntTuning path.

Four real cases fail against the initial radius-only observation; all
six pass after wiring advanced senses. The tests use real Rapier, an
actual world wall and actual version1 sprint commands, with the player
still behind the creature. Radius edges, second-player selection,
foreign/parked/dead seats and no owner/RNG mutation are explicit. Full
types and lint pass. This foundation is not yet connected to every
native recipe: CC44b owns that integration and exact continuation.
Hosted qualification remains with the normal engine batch land.
