# engine: design

Status: draft 2026-11-05: scaffold only; the real design arrives with the import.

Living doc: **how** this repo is built. What it does and why is
`docs/prd.md`. Keep this true as the code changes.

## Today

Only the scaffold exists:

- `src/cli/`: the CLI (`--version`, `--help`; commands arrive with the import).
- `src/test/helpers/`: shared test helpers; `git.ts` makes real git repos in temp dirs.
- `src/server/`: the Hono app (`GET /api/health`) and `serve.ts`.
- `src/shared/`: zod schemas used on both sides of the wire.
- `src/client/`: the Preact web app, with its own `tsconfig.json` (DOM lib).
- `src/tools/build-web.ts`: esbuild into `src/dist/web` (`--dev` watches and serves).
- `src/e2e/`: Playwright: the status page, and `smoke/`, the Template 2 smoke.
- `src/cook/`: shardfile to runtime packs.
- `src/scripts/check-sides.mjs`: the side rule (`pnpm check:sides`).
- `src/scripts/`: repo tooling (asks, md-wrap), plain JS.

## Dependencies

- `shardfile`, by git tag (`github:project-wildshard/<repo>#vX.Y.Z`)

## Boundaries the checks enforce

- `src/client` never imports `src/server` and vice versa; `src/shared` imports neither; `src/cook` never imports `src/client` (src/scripts/check-sides.mjs)
- `src/shared`, `src/server` and `src/cook` compile without the DOM library (the root tsconfig has no `dom` lib); only `src/client` sees the DOM

## The four sides

Like Source's `game/shared` built into both DLLs, or an Unreal client and
dedicated-server target from one project:

| Side | Holds | May import |
|---|---|---|
| `src/shared/` | Tick core, collision from packs, movement, entity state with replication declarations, input commands, snapshots | `shared` only; no DOM |
| `src/server/` | Authority: AI, combat resolution, quests, loot, grid, saves | `shared`, `server`; no DOM |
| `src/client/` | Rendering, UI, audio, input, interpolation, prediction glue | `shared`, `client` |
| `src/cook/` | Shardfile to runtime packs, per target | `shared`, `cook`; no DOM |

Targets: client, server (+ cook worker), standalone (server in a Web Worker
beside the client, a listen server).

## Coming with the import

- src/engine/ and src/game/, re-sorted into shared/client/server/cook by the P1 E2 ownership map
- the headless host (src/sdk/headless.ts and the tick worker files)
- the cook (scripts/app-build/spawnParts.ts and the pack builder)
- the app shell (src/*.ts, index.html, vite.config.ts)
- `src/commons/`
- shared assets (public/assets/{gpu,tex,music,sfx,hdri,models,baked}) and highway/centre art
- Measured cut (ENGINE-CUT.md): 10 imports to cut, 36k LOC of browser-only logic to wire into the server tick, 17k of client loading to rewrite, 14-19k LOC to split.
- After this move singleplayer no longer ships; the game deploys from here (Vercel `wildshard-singleplayer`).
