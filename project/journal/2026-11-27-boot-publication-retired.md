# The boot publication facts file is retired (QA 11-26 row 33)

Lane opus-public, found on SF13. `src/scripts/boot-publication.generated.json`
had no writer since the lean-layout move (f928fdae2): `publishBootPublication`
had no caller outside its own test. The build never read it (gen.ts builds the
boot byte and version tables from the asset tree it serves). Its only reader
was `boot-publication-proof.mjs`, reached through
`committed-source-tables.mjs --after-publication`, which only a fixture test
ran, and 1117 of its 2202 byte rows named files no built checkout has.

Gone: the file, the proof, the `--after-publication` mode and its fixture
test, `publishBootPublication` and the rest of the facts reader with its test,
the file's slot in the source-table cache key, and the registry row naming its
producer (`scripts/bake-packs.mjs`, which no longer exists).
`boot-publication.mjs` keeps the two formatters gen.ts uses; their header now
names gen.ts and the served asset tree, and `packs.generated.ts` says no
generator writes it. Guard: `test/committed-source-tables.test.ts` fails if
any tracked file names the retired file, proof, mode or functions.
