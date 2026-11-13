# Host ruler (meta HOST-RULER-PLAN)

- HR1 (opus-hr1): `scripts/host-ruler/roots.mjs` lists a built product's
  page and section roots: each client/plan kind roots only its own
  CLIENT_FEATURES entry's import() targets (read statically, three shapes),
  each section its row in the moved section-host table (side-first paths;
  `combat/items` and `quests/directors` re-pointed; `client/plan` no longer
  roots the whole dispatch table). clientPlan.ts's runtime static imports
  are the shared `@client-plan` root; type-only imports root nothing.
  A review caught type-only imports listed as roots; fixed before landing.
