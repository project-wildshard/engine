# The host bar: what goes in the engine, the game, or the shard

> Written by: Claude (lane opus-hr5, HOST-RULER HR5). State: live 2026-11-13. Copied from singleplayer
> `docs/HOST-BAR.md` at `48d24fdbbd` (the bar only, side-first paths); its host lists moved into
> [`lint/host-register.json`](../lint/host-register.json). Plan: meta `docs/plans/HOST-RULER-PLAN.md`.

The scoring matrix for every platform host and every proposed one. A host is shared code in engine's
`src/<side>/engine`, `src/<side>/game` or the `@wildshard/format` package that shards drive. Jake set the bar in G454
(2026-10-16) and asked for it to be written down as permanent design (G481, 2026-10-17): *"the engine is supposed to be
very flexible and not have all kinds of random Sky specific and Dune specific if statements in them."* G decisions are
singleplayer's `docs/plans/decisions.md`; J decisions are meta's `docs/plans/multi-repo/MULTI-REPO-PLAN.md` section 2.

## Where code belongs

| Place | What it holds | Test |
|---|---|---|
| **Engine** (`src/<side>/engine`) | Rendering, physics, input, audio, boot, levels in general | Knows nothing of the game, Wildshard, shards or content. Engine words only (E405) |
| **Game** (`src/<side>/game`, rows in `@wildshard/format`) | Wildshard concepts two or more shards use, driven by rows | Knows it is Wildshard; never names a shard |
| **Shard data** | JSON, sections, GLB, look-graph JSON, generator output | No runtime code |
| **Shard AssemblyScript** | Rules, decisions and story only this shard has | Event-driven, at most 10 Hz, through Script ABI commands; within 10 % of legacy lines (G463) |
| **Shard view code** (TS that stays) | Per-frame drawing or page wiring only this shard has and not worth a host | Listed with a reason; counted as custom |
| **Delete** | Dead code, finished Debug rows, legacy paths | Nothing reaches it |

`generators/` is build-time code and never counts as custom (G467), but only for files no runtime or headless file
imports.

## The six tests

A host counts as shared platform code only if it passes all six. Score each test 1 (pass) or 0 (fail), with file:line
evidence for every fail. In the register a row's `score` names them `twoRealUsers`, `noShardNouns`, `dataDriven`,
`serverSafe`, `deletionTest` and `dataOnlyApi`.

1. **Two real users.** Two shards drive it today. *Exception:* a register row with verdict `engine` or `game` on a
   Jake decision (day-one features G473–G484; one-user hosts Jake approved one by one, G595), or a `pending` row that
   names its expected user and a recheck date. A pending row whose user never adopts it by its recheck charges back.
2. **No shard nouns.** No shard names, ids, shard-only constants or `if (shard === …)` / `mode === 'board'` branches.
3. **Data-driven.** Shards differ only in the data they declare, not in parameter lists shaped like one shard.
4. **Server-safe**, or labelled as client-only presentation.
5. **Deletion test.** You would keep it if its first shard vanished.
6. **Data-only API** (G454 (5)). The API takes rows and ids. A per-shard hook is an AssemblyScript script reference,
   never a TS callback, subclass override, port object or `{owner, path}` reflection into shard code.

## Verdicts

| Score | Verdict | Register `verdict` | What happens |
|---|---|---|---|
| 6 / 6 (or 5 / 6 failing only test 1 under its exception) | **Real engine feature** or **real game host** | `engine` / `game` | Counts as platform |
| 3–5 | **Borderline** | `borderline` | Named fix, a plan row and an owner; counts back to its shard if unfixed by its `recheck` |
| 0–2 | **Silly**: shard logic in a generic coat | `silly` | Loses credit at once; moves back to the shard as data, AssemblyScript or listed view code |
| not yet judged | **Pending** | `pending` | Awaits its second user or Jake's one-by-one approval (G595); charges back after its `recheck` |

**Single-shot code** (exactly one use, no plausible second user) is never a new host. It becomes a row, a number or an
AssemblyScript script.

**G595 (Jake, 2026-10-22): every one-user host needs Jake's own approval, host by host** (the plan agent brings each
with its tests 2–6 scores); rejected hosts fold back into the shard as data / AS / WASM.

## Nothing is free: net platform lines

Moving a line out of a shard into a host is not a cut until the host passes the bar. Every report shows shard lines
cut **and** platform lines added (G455, G466 (9)). A wave that removes 800 shard lines and adds 1,800 platform lines
has grown the codebase; the hosts earn it back only as more shards adopt them.

## The register

[`lint/host-register.json`](../lint/host-register.json) is the one list of host verdicts: one row per module or
`module#binding`, keyed by its side-first engine path (`src/client/game/x.ts`) or its format package path
(`@wildshard/format/src/format/x.ts`). Each row has a `verdict`, an optional `score`, the G or J `decision` behind it,
the `users` known when it was written, a `recheck` date (pending and borderline only) and `from`, the old-list line it
came from. A binding row is more specific than its module's row.

`scripts/host-ruler/register.mjs` reads it and refuses a row whose module is missing, whose binding the module never
names, whose decision id is not in the pinned decision lists the register carries, or whose recheck date is missing or
misplaced; and it refuses unless the row count equals the source rows minus the listed `merged` and `dropped` ones.
HR5 migrated it from engine's old pending-users list, chargeback table, host reviews and listed-view list, and
singleplayer HOST-BAR's G571 and G599–G677 lines; `sources` names each at the engine commit it was read from. HR9
retired those lists, the old census and the one-off migration script with them. Stale pending rows carry one recheck date, 2026-12-11 (Kitchen Sink Q4).
