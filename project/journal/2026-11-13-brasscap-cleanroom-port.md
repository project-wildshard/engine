# Brasscap cleanroom port (TEMPLATES-CLEANROOM B2)

Lane opus-brassport, 2026-11-13.

- A data look now draws shard-format v0.4.10's `look.light.lamps` (shadowless point lights), `bounce`
  (a shadowless directional from the anti-sun heading, aimed by the clock), `environment` (a PMREM of
  the look's own dome over a ground disc, built once in the backdrop, set as `scene.environment` in
  compose) and `look.grade.tone` neutral (the clean chain's tone effect to NEUTRAL; a grid cell gets
  the same `NeutralToneEffect` display the painted look uses). Before, a shardfile look had no
  environment at all, so its PBR surfaces had no sky ambient.
- Look light (LF1-4's Debug row) defaults on for desktop; a saved `off` still wins. Without it,
  Brasscap's AO, rim, bloom and the new lights never drew for players.
- Brasscap's 20 cameras: the board is on JAKE-READ-LIST (meta TEMPLATES-CLEANROOM B2).
