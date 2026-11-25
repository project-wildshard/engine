# An org package's Node range now has to cover engine's

> Written by: Claude (opus-failmodes), meta QA 11-25 row 42

Engine moved to `engines.node >=24.18.0 <27` and then to format 0.79.2, whose published range still said `<25`. Every laptop runs
Node 24, so nothing went red until server-release resolved Node 26.13.1 and `pnpm install` refused the format (engine-strict).

`node scripts/node-ranges.mjs` (check:node-ranges, in the push gate and ci job 1) reads each installed `@wildshard/*` package's
range and refuses one that leaves out any Node engine's own range lets a workflow pick. It reads the ranges, not the running Node,
so a Node 24 push still catches it.
