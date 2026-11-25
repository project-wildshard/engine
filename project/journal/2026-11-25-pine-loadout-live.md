# The harbour ammunition test reads Pine's loadout from its pin

> Written by: Claude (lane opus-fp54b), FORMAT-PRUNE FP57

Pinning Pine r17 turned `test/held-loadout-platform.test.ts` red: r17's weapons have no closed slot names any more
(FP22), so they play as `declared.<item>`, but the test's stored copy of Pine's loadout still named `rifle` and `bow`,
and the native ammunition owner found no ranged item under those names. The test now reads `held/loadout` from the
same live pin as its items (J507: no stored zone copies), and the stored file is gone.
