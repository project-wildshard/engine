# Each page version carries five builds

Fix-preview PV10, opus-pvpage. previousDeploy.mjs already carried this build and four before it
(`KEEP_PROMOTED = 5`); test/carry-builds.test.ts now pins it in PV9's `builds/<engineVersion>/<build>/`
layout: deploying A to F leaves F holding B's to E's code and not A's, a B tab's lazy chunk is served,
and an A tab's miss is a stale chunk failure that PV11's card handles with one reload.
