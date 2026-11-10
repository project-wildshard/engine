# Cook jobs read the installed runtime closure

The global virtual store moves declared runtime packages outside the root.
Node resolves their real paths before reading package metadata or source.
The original permission-limited cook child therefore refuses valid packages.
This is a launcher boundary failure, not a phantom runtime dependency.

G1 reproduces it through the actual public runJob function.
An owned installation has a root package, a transitive package and a peer.
Its transitive dependency cycles back to the entry package.
An absent optional dependency remains absent.
An unrelated development package lives in another external slot.
The original classic layout passes.
The original external layout dies with ERR_ACCESS_DENIED.

G2 discovers only the trusted root runtime installation.
It walks dependencies, optional dependencies and present peers by real path.
It excludes devDependencies and deduplicates cycles by canonical directory.
Required missing dependencies refuse before a child is spawned.
Each external package receives its canonical package read capability.
Node also gets the exact declared lookup path before following its link.
No directory-wide node_modules grant is used, even for a pnpm slot.
Neither the whole store nor a home directory is granted.
No package name or path is accepted from a shardfile.

The computed closure belongs to the launcher lifetime through a WeakMap.
A different root on the same launcher is recomputed.
A manifest-free standalone launcher keeps its old root-only permissions.
Classic installations produce no additional flags.
The external unrelated development package remains unreadable.
Filesystem writes, credentials, network, heap, RSS and clocks stay unchanged.

Actual original cook, refusal, validation, hostile and GC cases pass29/29.
The three real q11 CPU-limit cases pass separately with their original laws.
The final focused permission proof covers classic, external and bare roots.
Type and lint results, one-shot review and normal publication follow below.
No full gate, hosted qualification or default global-store flip is claimed.

J206 identified one MUST in the first implementation.
An arbitrary external node_modules parent widened reads to its siblings.
The actual adjacent-layout case reproduced reading the unrelated dev file.
Replace that broad grant with canonical package plus exact lookup paths.
The same real boundary now refuses that read and still imports its runtime.
Classic, separate external slots, adjacent packages and bare launcher pass.
The one-shot review report is retained; no second review is requested.
Typed lint and the complete test TypeScript build pass.
Final source re-runs the unchanged original cook cohorts under the store.
