# A native page draws its declared species (OF23e4)

> Written by: Claude (opus-of-pine)

Pine r10 drops `actors/species-programs`, the hull book, the rigged hulls and the `population.hull-book` page feature.
The hull book's kit was what registered Pine's deer, elk, boar, bear and King on the page, so the local r10 product
stopped at `level.kit` with "unknown animal kind 'deer' (registered: boar, bear)". A native runtime page whose species
are only its declared rows now registers them itself (`declarePageCreatures`) and keeps the rest of that kit: the held
equipment and each socket card's rows. With it r10 loads its crossbow HUD and reaches "Joining the world", where the
pinned r9 control also sits on the same headless dev world.

In play the declared skins' glTF bodies share one interleaved vertex buffer, and the far herd refused them
("farHerd: attribute 'normal' is interleaved") on the first frame a herd went far. The far herd now copies such an
attribute flat. Headless shots of r10 then show its elk, deer and boar drawn, with the crossbow held.

OF29e1: a native plan that names no `population.*` host now stands the population family from the product's declared
files (habitat, shelter, roster, elites, each spawn script no elite fight owns, elites ready), in the hosts' order, as the
weather and taming rows already do. Pine's pinned product with its six hosts cut runs 1800 ticks digest for digest as with
them, and restores exactly; with the synthesis off its boot digest differs. Pine r11 can drop the hosts (OF29e2).
