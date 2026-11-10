# Developing engine

Living doc: commands, layout, code rules and git hooks. AGENTS.md links
here; what the repo does is `docs/prd.md`, how it is built `docs/design.md`.

## Commands

Run from the repo root.

- `pnpm install`: installs deps and points `core.hooksPath` at `.githooks/`,
  through `pnpm:devPreinstall`. Never use `prepare` here (`../leftover/docs/repo-kit.md`).
- `pnpm tools:install`: installs TypeScript7 and oxfmt from the committed
  `.bin-deps` lock into npr's shared cache, with `--frozen`. CI runs this
  after dependencies install. Typecheck/format commands use these pins;
  the optional TypeScript6 peer in node_modules is only a library.
- `pnpm check`: typecheck + lint + format:check + unit tests + the side rule + asks. The pre-push hook runs it.
- `pnpm test`: `node:test` on `src/**/*.test.ts`, run as .ts by Node's type stripping.
- `pnpm test:hooks`: the `.githooks/` suite (CI, and pre-commit when hooks change).
- `pnpm dev`: esbuild watch + the server on http://127.0.0.1:4402.
- `pnpm build`: builds the web app into `src/dist/web`.
- `pnpm test:e2e`: Playwright against a built app. CI only.
- `pnpm lint:fix` / `pnpm format`: the hooks only check; these fix.
- `node src/cli/main.ts --help`: the CLI without installing it. `serve [--port n]` starts the server (default 4402).
- `pnpm md:wrap`: rewraps Markdown prose to ~72 columns.
- `src/scripts/ask-new.sh "<Jake's words>"`: opens an ask (`docs/tasks/asks/README.md`).

## Progress epochs

`AppIdentity.saveEpoch` isolates a progress generation. `savePrefix` must be
a sibling of the previous prefix, and `serverSaveDatabase()` selects a
separate IndexedDB database. `previousSavePrefix` carries only settings,
graphics and device preferences on first boot; `identityPrefix` keeps the
device identity stable. Completion never reloads the page. Imports must
match the active epoch before any write or server stop. Keep the root
`save-epoch.json` equal to the application identity; the builder checks it
and publishes it in `version.json`. Snapshot format versions are separate.

Run the real storage boundary proof explicitly:
`scripts/browser-lane.sh node --test test/save-epoch-browser.proof.mjs`.

## Layout

The root stays thin: README.md and AGENTS.md (humans only), CLAUDE.md
(`@AGENTS.md`), package.json, pnpm-lock.yaml, .npmrc, .gitignore,
.editorconfig, `docs/`, `project/`, `src/` and the dot dirs. Scratch
goes in `tmp/<task>/` and is deleted when done.

- `src/cli/`: the CLI (`--version`, `--help`; commands arrive with the import).
- `src/test/helpers/`: shared test helpers; `git.ts` makes real git repos in temp dirs.
- `src/server/`: the Hono app (`GET /api/health`) and `serve.ts`.
- `src/shared/`: zod schemas used on both sides of the wire.
- `src/client/`: the Preact web app, with its own `tsconfig.json` (DOM lib).
- `src/tools/build-web.ts`: esbuild into `src/dist/web` (`--dev` watches and serves).
- `src/e2e/`: Playwright smoke test (CI).
- `src/cook/`: shardfile to runtime packs.
- `src/scripts/check-sides.mjs`: the side rule (`pnpm check:sides`).
- `src/scripts/`: repo tooling (asks, md-wrap), plain JS.
- `docs/`: living docs. `docs/plans/` is the queue, `docs/tasks/asks/`
  the receipts.
- `project/`: history. `journal/`, `origins/` (the meta-repo plans this
  repo came from), `archive/`.

## Code rules

- TypeScript only, imports with explicit `.ts`/`.tsx` extensions.
- Every function has an explicit return type. `src/.oxlintrc.json` denies
  every category (D28); disable a rule only with a one-line reason beside it.
- Pin dependencies exactly (`.npmrc` has `save-exact=true`).
- Other Wildshard repos are git dependencies pinned by tag
  (`github:project-wildshard/<repo>#vX.Y.Z`). They are private, so CI reads
  them with the org GitHub App token.
- Tests use real things (git in temp dirs, real files and processes); never
  mock git. No LLM, `claude`, herdr or network in tests.

## Git hooks

| Hook | Checks | Bypass |
| --- | --- | --- |
| commit-msg | Conventional Commits subject ≤ 50, body ≤ 72, one `Assisted-by: AGENT:MODEL` trailer, no AI `Co-Authored-By` | `SKIP_ATTRIB=1` (human-only commit) |
| pre-commit | `main` in the main checkout (D27), staged set echo, whitespace, 1 MB cap, credentials, sh / mjs syntax, new-plan Status line, journal (D25) | `ALLOW_BRANCH=1`, `ALLOW_BIG=1`, `ALLOW_SECRET=1`, `SKIP_JOURNAL=1` |
| pre-commit | lint + format:check on staged code, typecheck; 8 s budget | `SKIP_BUDGET=1` (time only), `SKIP_CHECK=1` |
| pre-push | outgoing commits: size, credentials, syntax; then `pnpm check` | `ALLOW_BIG=1`, `ALLOW_SECRET=1`, `SKIP_CHECK=1` |

Bypasses are for the case they name, never for a red gate: fix the code,
not the gate.

Frozen product image fallbacks may be listed in `test/pins/assets.json`.
Their small files live under `test/pins/assets/`, with immutable producer
Git provenance, SHA-256 and byte count. `pins.ts install` validates them
before publishing through its ordinary mount ledger. Remove an old
bridge pin when refreshing to a product that carries the same URL; a
different body is a hard publication collision, never an override. The
app build checks every declared baked texture mode before bundling and
again in final output, including the native image fallback.

Larger original model fallbacks use `remote: true` pins from an immutable
public producer commit (including the frozen singleplayer source). The
installer downloads them to the normal pins cache, bounds the stream to
the declared length, and verifies SHA-256 plus the source Git blob before
publication. No mutable branch, token or private checkout is needed.
Native model-map source keys are checked as well as the boot file lists;
CPU model fallbacks must survive final output pruning too.

## Exact item-model admission

The client model owner hashes only the supplied Uint8Array byte span,
including Node Buffer subclasses backed by a larger allocation. Shared
models stay live until their last Scope retires; late owners decode anew.
Run the native client-data proof explicitly, outside hooks:
`node --import ./scripts/bake-loader.mjs --experimental-transform-types
--test test/ci/entry-model-values.proof.mjs` as one command. It uses the
renderer-capable author loader, not the simulation loader or a browser.
CI runs all three real geometry/lifetime/refusal/span cases with 9.5 s
timeout and complete-body elapsed limits. No production socket is used.
