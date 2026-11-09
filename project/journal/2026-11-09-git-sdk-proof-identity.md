# Match the actual Git compiler environment

Some immutable queue gates have run the same full suite again inside Git.
Queue56 correctly reused its proof, so this was not a universal cache
failure. The new explicit outside-hook push-cache-git-proof reproduces a
specific miss through a real local Git remote and actual pre-push hook:
the same checked tree's receipt is absent under the hook's runtime hash.
Diagnostics print changed key names only, never environment values.

The four differing fields are CPATH, LIBRARY_PATH, MANPATH and SDKROOT.
Apple's Git launcher selects them before starting its child. Normalizing
only Git's PATH prefix does not normalize those compiler inputs. Dropping
them from the cache key would hide a real SDK/header/library change.

pushEnvironment now asks a real Git external subcommand to observe only
those four fields before the gate starts. It uses the original caller
search path to select Git, then runs the gate under the same selected
compiler environment as the actual push. The helper directory is not
left in the gate's PATH. On macOS, repeated identical MANPATH entries are
deduplicated in order: repeating a manual search directory changes no
lookup, while xcrun otherwise appends it on every nested invocation.
Linux keeps its existing environment behavior.

The actual protocol was red before this forward in under half a second.
It is green afterwards: two real pushes reuse complete tiny-fixture
proofs; changing CPATH refuses publication until the actual fixture is
rechecked under the changed compiler environment. Each of the four SDK
fields still invalidates the fingerprint, and normalization is idempotent.
The original dirty/tree/scope/corrupt/CI-always-run proof and two-real-lease
proof also pass. All scripts are manual, outside hook discovery, under
ten seconds. No full-suite saving is claimed before normal publication.
The hook still performs history/secrets checks before reuse, and a miss
still runs its entire authenticated gate. No receipt is forged or copied.
