# Pin CLI tools outside the engine install

NM2 follows the explicit two-tool handoff.
TypeScript7 and oxfmt move to npm-bin-deps2.1.0.
Oxlint remains a dependency because commit tooling imports its API.
Its typed-lint binary remains beside that library for this change.
No oxlint API consumer is redirected through an executable path.

Removing the old compiler first reproduced an actual failure.
The hard-coded path fell back to the optional TypeScript6 peer.
It refused the native --builders option with TS5072.
That is why PATH and optional-peer selection cannot choose the tool.

Typecheck, native build and formatting scripts now invoke npr.
The root scenario command invokes the pinned npr tsc binary.
The input-reading census resolves npr which tsc explicitly.
The JSON/native declaration checks use the same compiler route.
Their real child-process fixtures retain failure propagation.

The generated bin-deps manifest, lock and pnpm rules are committed.
The cache is keyed by those files and remains outside the repo.
CI restores it and installs it frozen after pnpm dependencies.
The preinstall hook cannot run a binary not installed yet.
It therefore stays hook setup only; tools:install is the explicit
local frozen command and the first npr use also honors the lock.
No prepare/postinstall hook is added to Git dependency consumers.

Whole-source types, root scenarios and format checks pass.
Four selected files pass8cases in2.20seconds.
The input-reading file passes its two cases in376ms.
After normal pnpm prune, modules fall403.6to358.3MiB.
The45.3MiB moves into a shared pinned install, not into Git.
The bin-deps directory itself is16KiB.
The retained TypeScript library resolves to6.0.3 as before.
Normal commit hooks and the release publication reservation remain.
