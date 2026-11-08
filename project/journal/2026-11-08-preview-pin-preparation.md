# Keep preview lease fixtures at the preparation boundary

The normal full push at 9fdd378 failed three preview-lease partitions.
Their minimal export does not contain the real production pin installer.
serve-build now runs node scripts/pins.ts install before generation.
The existing fixture Node wrapper knew generation and build work only.
It therefore accidentally fell through into the real Node executable.

Reproduce with the actual Bash preview path and concurrent starts case.
It fails in 0.663 seconds, exit 1 rather than 0, MODULE_NOT_FOUND pins.ts.
This is not a port or listener timing flake, and is not quarantined.
The root is a newly added external preparation role missing in the fixture.

Add only that exact Node entry to the existing preparation stub.
Its arguments must equal install; unexpected commands still fail.
The generator/build roles remain exactly where they were.
Real Bash, detached process spawn, sockets and listeners still execute.
Real reservations, registry publication, sharing and release still execute.
No lease assertion, original case, command deadline or retry is removed.
Production renderer and preparation source are untouched by this forward.

All three actual Vitest wrappers run their original Python partitions.
They pass 3/3, zero skipped, in 6.300, 7.718 and 8.112 file seconds.
Full layered pnpm typecheck now passes with peer type fix 0c16929.
The original normal full gate remains required before any upload.

Required generation refreshes scripts/renderer-revision.json to current
checked script inputs, including this tracked Python fixture and the
already committed renderer/mirror forwards. Its inventory is conservative.
The resulting revision is 7d1dd888e906fe44ec77ea608597b440a61c5ad4f062c4b0fa0883d6eaea0d1d.
j189 owns the SDK renderer/preparation pin update and knows this fence.
This change does not edit its reserved renderer module or proof file.

No new tests enter hooks, no quarantine deadline changes and no bypass.
The held DL21/credits/NM/FL chain still rides the next green normal push.
