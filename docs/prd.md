# engine: PRD

Status: draft 2026-11-05: drafted by Claude from `Raynos/project-wildshard-meta` plans, for Jake to correct.

Living doc: **what** this repo does and **why**. How it is built is
`docs/design.md`; decisions are `docs/decisions.md`; the first plan is
in `docs/plans/`. Requirement ids (`R-1`) are stable: cite them from
plans, commits and tests.

## In Jake's words (REPOS.md)

> Which contains
>   ./shared ( protocol, snapshot, movement, collisison, entity state, replication of entityt state etc etc )
>   ./client ( the client side of the engine, the game )
>   ./server ( the server side of the engine, the MMO server )
>   ./cook ( shardfile -> runtime packs )
>
> The shardfile is the raw upload, the engine only runs on packs it cooked itself.
> The engine itself has lint rules to make sure ./client and ./server are completely seperate
> The engine has build targets to output the client and server binaries/websites as seperate things.
>
> Depends on shardfile

## One line

The Wildshard engine: one repo with shared, client, server and cook code and three build targets (client, dedicated server, standalone listen server), shaped like Unreal or Source.

## Requirements

- **R-1**: `src/shared/`: tick core, collision from packs, movement and physics, entity state with replication and prediction declarations, input commands, snapshots
- **R-2**: `src/server/`: authority (AI, creatures, combat resolution, quests, loot, ledger, weather, Wasm shard scripts, grid, saves); later rooms and persistence
- **R-3**: `src/client/`: rendering, UI, audio, input, interpolation, prediction glue, the app shell
- **R-4**: `src/cook/`: shardfile to runtime packs, per target; run only by the cook worker beside the MMO server
- **R-5**: The build targets: client, server (+ cook worker), standalone (server in a Web Worker beside the client)

## Not this repo

- The shardfile format (shardfile)
- Uploads (api-server)
- The author CLI and SDK (sharddev)
- Network transport, rooms, accounts, persistence (Jake's MMO plan)

## Who uses it

- sharddev
- leftover (native, admin)
