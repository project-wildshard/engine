# Join producer records before crediting command CPU

> Written by: Codex
> **State:** built locally, 2026-11-15; HOW-WE-BUILD TS12e1.

The bounded evidence reader joins a raw census, v2 push proof and the
matching full-test release. Machine/platform, kernel owner identity,
UID, lease token, runner/child, complete observed drain, full-v1/full
scope, successful reaping and contained lifetimes must agree. Both proof
and command keys prevent counting the same producer twice in a dataset.
CPU comes only from commandUsage; sampled sums never become exact totals.

The live fixture exposed two ProcessLookupError counter misses for child
processes that exited between samples. Their identities and the final
observed drain were complete. The recorder now separates censored counter
reads from missing identity reads while retaining the old incompleteReads
total. Counter gaps stay explicit lower bounds; identity gaps refuse the
join. A truncated report, unresolved child or missing producer still
refuses. Raw records also retain machine and final wall timestamp.

Linux birth epoch estimates are not stable identity keys across backend
instances. The join uses the exact boot/PID/start-tick identity, not those
rounded epoch estimates. Darwin uses the same maintained kernel identity
backend as discovery and the writer.

Two real Git/lease/writer/recorder fixtures join their own command records;
25 metadata/duplicate/legacy refusals, a real foreign producer and unsafe
or incomplete file controls pass. An extra censored-counter fixture keeps
the independent command CPU unchanged. These are complete fixture gates,
not full engine gates. CLI integration remains TS12e2; ten actual full
gates remain the parent TS12 bar.
