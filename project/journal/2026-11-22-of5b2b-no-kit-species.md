# OF5b2b: the engine holds no creature

> Written by: Claude (opus-of-close3), 2026-11-22

The page's boot no longer registers the kit boar and bear (`installKitSpecies` is a test fixture now, `test/fixtures/kitSpecies.ts`); it installs only the kit's default creature calls (`installKitCreatureSounds`). `SpeciesService.get` draws a kind from its declared row and look together and never falls back on the legacy registry. Every pinned product already pairs each row with a look (the one-way inventory's `products.rows-without-look` is 0), and Pine r11, Driftwood r9 and Nalati r6 declare their own boar, bear and herds. OF1's `engine.kit-registrations` and `engine.look-fallbacks` go to 0. The kit's `kit.look.boar` recipe stays for SDK authors. Proof: 15 species, look, entry and riding test files (103 tests) locally.
