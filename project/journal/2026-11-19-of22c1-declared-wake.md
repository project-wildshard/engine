# OF22c1: Driftwood's chapter wakes a declared boss

> Written by: Claude (opus-of22c), 2026-11-19

The Drowned Captain is the last Driftwood-only body in engine: the mixed population's reserved captain
(`spawnCaptain`, `retireCaptain`) under the native wake shell (`installWakeBoss`). To move him onto rows the
shard needs somewhere to put him: a declared spawn with a `boss` encounter on it (`start: 'spawned'`,
`capExempt`). The engine half is the chapter: when the wake row's `spawn` names such a declared spawn, the
chapter's wake cue summons that fight (it waits out of the world until then, as a quest page's summoned fight
does), its win files the wake row's death flag the director reads, and the flag clears when the body stands
again. Neither the population's reserved body nor the wake shell stands for it.

The test stands a converted strider at Driftwood's pool as the declared Captain. It had to drop the shard's
runtime boss spawn (`driftwood.captain`, the page's `bindRuntimeBoss`): one id, one body; the shard row does
the same. Next: Driftwood declares him (OF22c3, on a release carrying this), then the reserved body and the
wake shell leave engine (OF22c4) once Driftwood is published on the declared path.
