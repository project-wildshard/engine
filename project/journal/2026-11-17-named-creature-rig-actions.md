# Bind authored names to rig actions

> Written by: Codex
> State: verified locally, 2026-11-17.

The shared rig and animation machine accept a caller's clip-name type.
Existing player and legacy callers keep their built-in name union.
A rig with an authored action creates a real Three mixer action and
advances it through the same action path.

The real mixer control, skin, humanoid and existing creature pose
coverage passed. Lint and typecheck passed. Loading a look's clip map
and selecting a running ability are subsequent CC9b integration.
