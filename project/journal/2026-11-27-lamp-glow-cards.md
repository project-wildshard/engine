# Lamps past the reserve keep a glow card

> Written by: Claude (opus-qa-engine), 2026-11-27

QA 11-25 row 153. Jake picked "5 lights + glow cards" on 11-26 (~10:55 Cancún) for a grid page's crowded looks:
Glowfen declares 14 lamps and Mossgate 16, and the grid has 5 reserved lights. The nearest 5 keep their point lights
and hand them over with hysteresis (opus-lamp138's swap). Every other lamp now keeps a glow card: one instanced, additive
billboard draw for the whole look, each card its lamp's colour x 0.35, as wide as the lamp's halo or 0.8 m. A card fades
out as its lamp takes a light and back in as it gives the light up, so a lamp's light and its card add up to one lamp's
worth of glow and nothing pops. A dark lamp (its panel shut, its actor gone) shows no card. On a standalone page, which
already draws `lampHalos`, a fixed lamp with a halo keeps its halo and gets no card. A look within its reserve draws
exactly as before, with no cards.

The group now names its pool (`lights`), because the grid hands that pool to the page's reserved lights and the cards
are not lights. Guards: four tests in `look-lamps.test.ts`.
