# The cooked-map audit runs every night

MAP-NEXT MN6: `cooked-map-audit.yml` runs MN4's audit against staging and production nightly and by hand after a recook, red
naming the slug when a head lacks its map. The fixture test (a dropped map key goes red) runs first. Local run 2026-11-23: staging
40 mapped, production 53 mapped, 0 missing.
