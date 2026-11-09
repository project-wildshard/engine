# A queue worker must not inherit gate bypasses

Opus MUST-FIX1 reproduces through the actual queue and a disposable Git
remote: the first enqueuer carries SKIP_CHECK/ALLOW_BIG/ALLOW_SECRET and
related flags. Its detached worker drains two requested commits. The old
worker publishes both the valid commit and a later invalid value from a
clean enqueuer, because it still carries the first caller's bypass flag.
The new explicit push-queue-env-proof is red with states pushed/pushed.
No bypass flag is applied to a real repository hook during this proof.

Worker startup and every checked-job environment now use the same small
allowlist of OS/tool search paths, locale, CA/proxy and SSH transport,
compiler SDK inputs and the audit location. Full suite and SSH
keepalives are forced. SKIP_*, ALLOW_*, NODE_OPTIONS, loader variables,
caller test selections, CPU grants and lease tokens are not inherited.
This is an allowlist, not a blacklist of the three reported names.

The same real two-job proof is green: the valid value passes the actual
manual and Git hooks, the invalid value refuses, the remote remains the
checked valid commit, all observed gate environments lack the bypasses,
and both snapshots drain. Existing source dirty-byte isolation, normal
history checks and the complete configured suite remain mandatory.
The proof is manual, outside hook/Vitest discovery, under ten seconds.
No gate is omitted, deadline extended or credential copied into source.
