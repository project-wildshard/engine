# Ring 1 consumes its server slices

TC29, codex-pins, 2026-11-15. Work follows the TC21 landing dc84752829.

The shared product reader preferred a complete output left by an earlier
install, including its CI exact-SHA path. Ring 1 now requires its configured
server slice first. A missing slice refuses with the install command. Full
suite and source-project readers retain their existing admission behavior.
No H1/H4/H5 fixture or export is changed.

The consumer proof expands the actual Driftwood pin, cuts its production
server inventory, walks that slice, removes it and observes refusal while
the complete pin remains present. It passed in 0.67 s. The proof itself
stays in Ring 2 because it reads the full reference archive; Ring 1 needs
no extra full-head download to exercise the promoted gameplay suites.

Five existing suites move into Ring 1 after actual sliced runs. The
network walk and melee have three cases (maximum 0.66 s); hostile-client
play has two (maximum 0.48 s); current-save continuation has eight
(maximum 3.19 s); real byte/time cook refusals have two (0.80 s per file);
damaged actual section/blob admission has two (1.41 s per file). Existing
assertions, clocks and process bounds are unchanged. The continuation
file takes 10.62 s in total, with each case under J186's ten seconds.

The proposed old-release-save promotion was rejected by the actual slice
run: its unconditional full asset read needs client GLBs, and its released
Brasscap fixture is not Ring 1's frozen format Template 2. It remains in
Ring 2, unchanged. Other retained Ring 2 admissions still need review;
this change does not claim all of TC29 complete.

The nonexistent client-item-projection-values entry was removed after
reviewing singleplayer a7d4519ae7646b660ec5139738e037f9471b231b.
That commit deleted the client save writer and its three implementation
comparison tests on November 7, before the engine split. Its documented
upgrade successor, standalone-page-saves, remains in Ring 2. No test body
or coverage is silently removed, and no empty replacement is added.

Local proofs use named files. Full-suite work belongs to hosted CI; no
coordinator-only override is used. Ring 1 installs were restored to the
normal full pins, followed by strict input generation, before checkpoint.

The Ring 1 selection parses its manifest with the existing Valibot intake.
Malformed configuration cannot silently opt back into complete products.
Root-config focused lint and the layer typecheck pass.
