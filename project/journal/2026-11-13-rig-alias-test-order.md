# Rig alias test: load the parser before setting a modifier

Main's CI (run 43456598348, tests (2)) went red on
`rig-resource-aliases.test.ts`: "No asset tables installed". OF17
(`e4cb7b1f`) made `core/ktx2.ts` import `boot/bytes.ts`, and bytes
installs the page's URL modifier on three's default manager as it loads.
`loadRigFile` imports `rigParser` (which imports ktx2) on first use, so in
the first test that import landed after the test had set its own
modifier and replaced it with the page's, which reads the asset tables.
The second test passed because the module was already loaded.

The fix is in the test only: a `beforeAll` imports `rigParser` first. The
page boots bytes long before any rig loads, so OF17's behaviour is
unchanged.
