# Native CI proof bounds

The failed engine CI already reproduced genuine long work: bot taming
took 148.6 s; the observation reference completed all 240 checkpoints,
restored, and finished its suffix in 31.6 s after Vitest's 30 s timeout.
Practice's child hit its 30 s spawnSync limit, once after printing its
story. The bounded two-worker run passed these at 72.8 s, 18.2 s and
16.0 s respectively. Ring 1 now uses that same outer pool limit.

Only outer proof budgets grow: bot child/test 240/245 s, practice
60/65 s, observation 60 s. Native tick and 30 s request watchdogs
stay unchanged. Child proofs now await execFile with Vitest's abort
signal, so a test timeout can cancel its owned process. Observation
workers are registered for test-finish cleanup, including failed setup.

Ring 1's actual failed trace spent its full 10 s capture allowance at
compositor-frame; the diagnostic native capture then took 7.4 s. One
attempt now gets at most 30 s within the original boot deadline. Pixel,
viewport, black-frame, live-frame and no-retry assertions are unchanged.
The paused-virtual-time experiment stalled native capture rather than
the frame callback; it supplied no cause fix and was removed.

Chrome's known Linux refusal was blocked in folio_wait_bit_common with
no endpoint. Singleplayer 9052d50ac2 added exact executable/resource
file reads and its deploy workflow invoked them immediately before the
Escape control. The lift carried the helper but dropped that invocation.
Restore it in the control suite's beforeAll, before either original
clock. The 10 s endpoint and 25 s child bounds, trusted Escape pair,
startup refusal diagnostics and strict profile/writer cleanup stay intact.
Local direct native input still passes (endpoint 307.8 ms); this warm
Mac does not qualify a cold Linux cache. The next ordinary CI does.

No application, rendering, gameplay or release files change. Push only
after the coordinator's v0.1.1 tag exists, with the full hook enabled.

Validation: all 22 native/fast-PNG/black-frame checks and all 9 original
Chrome preparation/input/refusal/cleanup checks pass. Types, full lint
and formatting pass. No new tests were added to any hook.
