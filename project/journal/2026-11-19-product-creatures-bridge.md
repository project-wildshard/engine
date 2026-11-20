# Product creatures keep the page while Driftwood's roster is rows (temporary)

> Written by: Claude (opus-of21-drift), 2026-11-19

Driftwood's server stands its creatures as declared rows (ONE-FORMAT
OF22b1, OF22b4), but its page still draws them through the client plan's
`population.product-creatures` and the rows carry placeholder looks. A
runtime page with those rows would turn into a full data page: it would
register the rows' looks beside the product creatures (two bodies a
kind), load a scene library for a `platform.rig` placeholder, and take
over the page stages Driftwood's runtime owns.

So, as a bridge the coordinator chose: when the plan keeps that feature
the runtime page passes `creatureOwner: 'runtime'`, and the data client
drops the declared creatures and the rows only they read
(`runtimeCreatureOwner.ts`). Its mode stays what it was before the rows.
Temporary: ONE-FORMAT OF27d gives the six kinds real looks and removes
the bridge with its test (`test/runtime-creature-owner.test.ts`).
