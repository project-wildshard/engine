# Plain brain roster

> Written by: Codex
> State: source proof, 2026-11-17. ONE-FORMAT OF26d1;
> hosted qualification follows the M2 batch land.

The original eleven is the SpeciesBrain union in engine
`src/server/game/plugin/brain.ts` at `96e047bea`. It counts both
`grazer` entries. The published format17 speciesBrain contract agrees.
`pursue` is additional. Aliases preserve tuning, controller and body;
counting alias names as independent algorithms would hide missing owners.

| Original entry          | Plain declaration                                                    | Existing controller/owner                                           |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| grazer/wander-ram       | ram-grazer; grazer/wander-ram                                        | RamGrazerBrain -> GrazerBrain                                       |
| grazer/circle-challenge | challenge-grazer; grazer/circle-challenge                            | ChallengeGrazerBrain -> GrazerBrain                                 |
| diver                   | orbit-diver, patrol-diver, burst-flyer; diver/orbit, /patrol, /burst | OrbitDiverBrain, PatrolDiverBrain, BurstFlyerBrain -> DiverBrain    |
| decision                | admitted sim/scripts, borrowed native owner                          | ShardDecisions; OF26d2 tracks actual grants                         |
| challenge-grazer        | challenge-grazer                                                     | Same circle-challenge controller                                    |
| patrol-diver            | patrol-diver                                                         | Same patrol controller                                              |
| script                  | script                                                               | ScriptBrainDriver in the composed lane; OF26d2 tracks actual grants |
| stalker                 | stalker/skirmish                                                     | SkirmisherBrain                                                     |
| skirmisher              | skirmisher                                                           | SkirmisherBrain                                                     |
| guardian                | guardian; guardian/interior, guardian/perch                          | GuardianBrain or PerchHunterBrain by pattern                        |
| perch-hunter            | perch-hunter                                                         | PerchHunterBrain                                                    |
| additional pursue       | pursue                                                               | preparePlatformBrains/PursuitBrain                                  |

`test/plain-brain-roster.test.ts` runs every nine canonical native
rows and eight accepted aliases in the actual default server with real
Rapier. No injected brain recipe, fabricated context or JSON callback is
used. Each canonical body deals its declared strike damage to the real
player and restores body/controller/RNG/health/physics exactly. Every
alias compares those states at each of 360 ticks. The source JSON stays
unchanged. This is a native declaration roster, not a claim that custom
script grants are already open to uploads.

Native recipes own distinct strike contracts: ram requires a lane;
challenge requires lane plus arc. The initial fixture used spheres and
correctly refused both. A body already beside its player may attack
without walking; the proof checks changed complete body state, not an
invented minimum displacement. Existing full skirmisher, guardian and
perch lifecycle/native parity controls remain alongside this matrix.

OF26d2 adds type-exhaustive maps for all eleven original union entries
and all eighteen current declared names/patterns. Decision is not a
`creatures.brains` kind: it uses admitted `sim/scripts`, native actor
bindings and ShardDecisions' existing body/strike owner. The existing
real decision suite proves fixed-step movement, strike, memory and
restore; two added ownership controls refuse native-plus-decision and
duplicate decision controllers before any guest invoke. The original
borrowed-owner and spawn-group tests remain enabled.

A custom `script` declaration still requires the trusted observation and
strike port. A plain JSON fixture refuses exactly `Missing custom brain
port`; no synthetic callback in JSON bypasses it. The trusted control
runs the actual composed ScriptBrainDriver and a frozen, metered ABI0
guest against real Rapier. Ten decisions in thirty ticks request the
existing host catalogue/runner, deal one declared7hp contact, respect
attack permission and restore the complete host snapshot without any
observation call. No `brain.<actor>` callback accompanies the script
lane. This boundary stays explicit for OF10's harm/budget ledger.

The new guest's source, compiler identity and hash are retained beside
its immutable WASM. It was compiled once with the landed SDK M1 source;
ordinary tests only load its bytes. The initial trusted test forgot to
register its strike catalogue and correctly produced no harm; the test
now lends the actual authored rows through registerStrikeCatalogue.
No runtime code or gate was changed for this audit.
