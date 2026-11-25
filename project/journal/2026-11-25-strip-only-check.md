# Every file Node runs strip-only is checked at push

> Written by: Claude (opus-sweep), 2026-11-25. Meta QA 11-25 row 25.

fc0832b52 put a TypeScript parameter property in the cook; Node runs the cook strip-only, and main stayed red for about
82 minutes. The lint override that refuses parameter properties covered `src/*/engine/**` and, after 525f4f3cd,
`src/cook/**`, but strip-only Node loads far more than that: 1,352 tool files (scripts, hooks, lint) and whatever they
import. A blanket lint is wrong too: about a hundred files elsewhere use parameter properties and only ever go through
Vite or Vitest.

`scripts/strip-only.mjs` walks the real import closure of every tool Node runs directly, resolving specifiers the way
Node does (`createRequire`, so the package's self-referencing exports count), and asks Node's own
`stripTypeScriptTypes` about each TypeScript file it reaches. A tool that some command runs with
`--experimental-transform-types` (named on that line, or the folded YAML line after) is not an entry. It found three
real ones (phone-loading's size ledger, the arena whirlwinds and the return program, reached from
`snapshot-admission-proof.mjs`), now plain fields. It runs in the push gate as `check:strip-only` (under 1 s);
`test/strip-only.test.mjs` plants a parameter property outside the cook and sees it refused.
