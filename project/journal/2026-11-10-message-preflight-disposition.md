# Restore engine's real message preflight proof

The inherited `commit-message-preflight` test copied a Python message checker
that does not exist in engine. Its original fixture also treated a single long
token as malformed, although engine's current policy deliberately allows it.
Use engine's actual JavaScript validator and an overlong ordinary-word body.
That repaired fixture exposes a real wrapper gap: malformed messages execute
expensive pre-commit work before the installed commit-message hook refuses.
The original CLI test is red with `malformed message ran expensive checks`.

Before input generation or the shared commit lock, the wrapper now imports the
same installed JavaScript `validate` function with the message on stdin. It
retains the Python fallback when that checker is the only one available. It
duplicates no policy and still executes all installed hooks for valid messages.
The actual unchanged outer-edge Vitest case passes in 3.42 seconds, including
fatal valid-hook failures, untouched foreign staging and the human-only path.
Its original ten-second child limit stays unchanged. No bypass is introduced.

Restore this file to ordinary blocking discovery and refresh the lift digest.
The owner, first registration and original November 10 18:00 UTC deadline stay
fixed. Local full/Ring 1 complete-module timings will be recorded as bootstrap
data, not hosted Linux evidence or a cached green result, before publication.
There are 383 other paths still requiring individual disposition. This test's
passing result says nothing about those files.
