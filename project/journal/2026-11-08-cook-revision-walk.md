# Identify the actual cook byte producer

Written by: Codex. 2026-11-08. P1, J186.

Walk runtime imports with the TypeScript parser from the production cook
job, resolving the engine's public exports and rejecting unresolved local
or dynamic imports. Include the host encoder wiring, this revision walker,
the frozen dependency lock, format pin, Node major and Brotli version.
The current closure has sixteen files. The whole lock is conservative:
an unrelated dependency change also invalidates the recipe. Simulation
proof execution is supplied by the host; its verdict is never reusable.

The real cold Template cook in an owned export produced revision 472c5447.
Changing its actual part alignment from sixteen to thirty-two changed the
revision to 05a0cba8 and changed actual served manifest/body hashes. Adding
an unrelated journal file changed neither that revision nor those bytes.
These were three real bounded production cooks, not a hash function test.

Ring-cook records the recipe and refuses if it changes during the batch.
This receipt enables a future cache; it does not reuse bytes or verdicts
and does not claim the installed CLI/dev-client boundary is solved.
