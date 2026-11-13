# Host ruler (meta HOST-RULER-PLAN)

- HR1 (opus-hr1): `scripts/host-ruler/roots.mjs` lists a built product's
  page and section roots: each client/plan kind roots only its own
  CLIENT_FEATURES entry's import() targets (read statically, three shapes),
  each section its row in the moved section-host table (side-first paths;
  `combat/items` and `quests/directors` re-pointed; `client/plan` no longer
  roots the whole dispatch table). clientPlan.ts's runtime static imports
  are the shared `@client-plan` root; type-only imports root nothing.
  A review caught type-only imports listed as roots; fixed before landing.
- HR5 (opus-hr5): `lint/host-register.json` is the one host register, read
  and validated by `scripts/host-ruler/register.mjs` (module there, binding
  named, decision in the pinned G/J lists, recheck placed, rows = sources
  minus the listed merges and drops). `register-migrate.mjs` built it from
  the pending-users list, the chargebacks, host-reviews, listed-view and
  singleplayer HOST-BAR's G571/G599–G677 lines at `48d24fdbbd`. The 73
  W3 pending entries that also carry an approved-feature decision
  (G473–G484) stay platform, as the old reader credited them, not pending
  as the row's wording says: flagged for Jake. 18 chargebacks drop (their
  modules or bindings are gone) for HR6 to re-find. `docs/HOST-BAR.md` holds the bar. Nothing
  reads the register yet (HR6).
