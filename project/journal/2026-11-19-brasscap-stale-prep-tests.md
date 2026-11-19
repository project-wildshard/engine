# 2026-11-19: the stale-preparation tests cook Brasscap by its slug

Lane: buddy-engine (keeper; MAIN RED b388dcff50..1c69066231, run 44501174339, tests (4) and (6)).

9cefedb2e made the stale-preparation fixture Brasscap Mesa in place of the Template, but both
cook tests still handed it in as slug `template`: the worker refused a shardfile for
`brasscap-mesa` under `template`, and the warning named `brasscap-mesa`. The tests now cook it as
`brasscap-mesa` and look for its program mount by that name.

9f6e0d723 added a gameplay-slice JSON blob without its companion type: `node
scripts/json-declarations.mjs` wrote the `.d.json.ts` and its `test/tsconfig.json` row.
