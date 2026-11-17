# Original rig names through actual playback

> Written by: Codex
> State: ONE-FORMAT CC10a1 source, 2026-11-17.

Three sanitizes dots and makes colliding spellings unique. Three real-GLB
controls failed first on missing hand.L/hand.R sockets, including actual
sampled look loading. Original node names now come from the parser's
source associations, never from the declaration being checked. Duplicate
original identities refuse. bindRig still checks actual ordered joints
against the admitted metadata; a forged declaration cannot rename a rig.

Tracks targeting a renamed joint use its loaded UUID for the mixer.
Client skin compilation resolves those UUIDs back to the original joint
names before sampling, so each instance's SkinDriver uses its existing
bone record. Source GLB bytes, rig/clip ownership and clocks are unchanged.

Actual GLBs with dotted joints and a sanitized-name collision exercise
mixer movement, hashed skin look loading and sampled instance movement.
Forged and ambiguous joint controls retain refusals. Exact red-first and
final matrices/types/lint are in tmp/codex-te2e/cc10a1-*; meta records
qualification. No browser/GPU or mocked loader proves these controls.
