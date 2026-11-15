# Lamps that follow, and lamps past 16 (SHARD-SOURCE AP24b, AP28; opus-ss16c)

- `lampLights` (`client/engine/render/lookLight.ts`) is now a fixed pool of at most 16 point lights (4 on a phone):
  each frame it gives them to the lamps nearest the camera, so a look may author up to 256 (shard-format v0.5.9) and
  the light count, and so every lit shader, never changes. With 16 or fewer fixed, unflickering lamps nothing updates
  and they draw exactly as before.
- A lamp with `follow { actor, bone? }` rides that actor's body or bone: the client worker registers
  `setLampFollow(scene, ...)` over `wirePage.namedBody`; the lamp is dark while the actor is not in the world. Its
  halo is left out for now (it would stay at the offset).
- The phone tier keeps every lamp and lights the nearest 4 (it took the first 4).
- Review (claude -p, no MUSTs): a following lamp renews its bone's world matrix before reading it (it trailed a frame). Noted: a phone now draws every lamp's halo (one instanced draw, as before, but more instances than the first 4); the 16th and 17th nearest swap with no hysteresis; the dev hook picks by the player's position and lights 16 on any tier.
