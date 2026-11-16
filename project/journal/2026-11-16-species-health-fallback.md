# Pine Hollow loads again: missing creature health falls back (SB25, buddy-engine)

- STAGING-BUGBASH SB25: staging v0.1.30 and main could not open Pine
  Hollow at all ("Pine Hollow could not load: Species deer has no valid
  health"), in Chromium and WebKit.
- Cause: d39d6c1d (require authored hunt numbers) made `speciesHealth`
  throw for a species with no authored hp. Pine's deer author none (only
  big-stag 90 and ghost 130 carry their own), so the page's first deer
  body, in `AnimalView` or `RowBodies`, threw during load.
- 5e2b6d8d had already kept the old deer/boar hunt numbers for native
  managers (`LEGACY_*_TUNING`), and the server's body paths kept
  `aggressive ? 100 : 60`. Only the page lost its fallback, so the page
  and the server disagreed even before it threw.
- Fix: `speciesHealth` takes the species' aggression and falls back to
  the pre-d39d6c1d built-in, 60 for a grazer and 100 for a charger
  (`LEGACY_HEALTH`, the old DEER_TUNING / BOAR_TUNING hp). Authored
  numbers still win: variant hp, then level fauna tuning, then species
  tuning. An authored value that is not a positive finite number still
  throws, because that is an authoring bug.
- Test `test/species-health-fallback.test.ts`: the pinned Pine Hollow
  product runs headless, and for every deer, boar and elk the page's
  call, fed Pine's own frozen species, gives the health the server gave
  that body. The plain deer get 60. With the old throw put back it fails
  with exactly the staging error.
- Left for Pine: author its own hunt numbers (a row in its plan), after
  which this fallback and `LEGACY_*_TUNING` can go together (ONE-FORMAT
  OF5b).
