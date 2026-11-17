# Linked compiler inputs use contents

EV8a's linked-package key used file bytes for changed tracked files, but
size/mtime for untracked and ignored source and plain directory packages.
The Git ignored-files query also collapsed ignored directories, omitting
source modules inside generated folders. Ordinary same-size edits with a
preserved timestamp could reuse an old author compiler payload.

The key now hashes actual file contents in each case. Git enumerates ignored
source files instead of collapsing directories, excluding dependency stores,
Git metadata, worktrees and scratch paths in the query. The author-bundle
namespace advances to version 6; completed input receipts, publication-race
checks, payload integrity and replay remain unchanged.

Four native compiler cache controls fail before the change: an untracked
module, ignored file, ignored generated folder and plain linked directory.
Each changes actual compiled payload bytes while holding file size and mtime
fixed. Afterward all 13 cache cases pass, including unchanged reuse,
concurrent linked edits, corrupt payloads and dependency receipt replay.
Shared-peer identity and the four actual linked shard builds remain separate
EV8b/c qualification rows; this unit result does not claim those builds.

The batch review found that enumerating every ignored source also included
unrelated checkout-root out, dist* and .tsc-layers products. A compiler that
wrote such a product during compilation falsely failed the race check.
Namespace 7 excludes these ignored root products while retaining generated
source below src. A bundle importing a root product always recompiles;
omitting that product from the namespace therefore cannot grant stale reuse.
Both artifact controls and the original content controls pass (15 cases).
