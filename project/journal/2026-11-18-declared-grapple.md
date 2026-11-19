# 2026-11-18: a plain grapple mode grapples (ONE-FORMAT OF41c)

opus-of-m7e. Engine pins shard-format 0.42.0, whose `state/modes` grapple row may carry its tool `profile`, `hooks`,
`guard` and `rise`. `installDeclaredGrapple` builds the native profile with the format's `declaredGrappleProfile` and
calls the same `installGrapple` the native `grapple` assembly row does, so a plain upload needs no native files. One
tool a shard: it owns its step id, the LOCK route and the `grapple` world-state rows. The tick port (`ports.grapple`)
defaults to each player's JUMP from the tick's own command and LOCK/aim from the admitted script values; a data cell
also turns a client's LOCK button (and the hook its camera picked) into a press, as the native room's net input does.
The page half (drawing the claw for a plain upload) is not in this row.

## Page half (opus-of-x2)

A plain upload's grapple now draws on the page the way the native held entry does. `installDeclaredGrapplePage`
(`src/client/game/grapple/declaredGrapple.ts`) builds the same `GrappleTool` from the row's profile and hooks, using the
platform's own presentation rows: a generated rope ribbon, neutral hook and LOCK words, and the native bursts. It
compiles the row's named looks from the shard's `look.materials`, binds the guard and adds the tool to the loadout, where
`clientWorker`'s `bindClaw` gives it the wire's claw. The server and the page now share `declaredGrappleRow` and
`declaredGrappleProfile` (`src/shared/game/grapple/declared.ts`). The equipped id is `tool.<row id>`, since every
equipped tool needs a `tool.` id.
