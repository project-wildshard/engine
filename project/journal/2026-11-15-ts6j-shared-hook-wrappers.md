# Share owned cache and hook wrappers

> Written by: Codex

> **State:** built locally, 2026-11-15; HOW-WE-BUILD TS6j.

Four Node suites share their parent worker: push-input-cache,
prebuilt-output, precommit-vocabulary and commit-message-preflight.
The maintained Python/Git controls still execute in fresh, synchronously
reaped children. Each owns its repositories, staged index, archive files
and hook environment; context managers remove their temporary trees.
Candidate checker paths and source bytes remain exact. Parent Node state,
environment and caches are not mutated by those children.

The initial isolated baseline found a real fixture portability error:
the local Python returned a relative temporary directory, and a directory
symlink used that relative path as if it were absolute. Resolve the owned
temporary root before creating the link. The existing link-materialization
and malicious-link-refusal control now drives its intended real path.
No packer code, assertion, hook refusal or deadline changed. All 17 Python
prebuilt controls pass through their original wrapper after this fix.

With the same path fix in both modes, one worker and unchanged production
setup/aliases: cold isolation 3.962 CPU-s; warm isolation 3.917 CPU-s;
shared forward/reverse 3.627/3.595 CPU-s. These are local full-process-tree
CPU observations via RUSAGE_CHILDREN. All four wrappers pass alone and
in both exact orders. No full-gate saving is claimed; TS12 must measure it.
