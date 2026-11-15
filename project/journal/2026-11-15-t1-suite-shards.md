# Four Template suite shards

T1E-2b gives every current spec one stable A/B/C/D owner. All four CI
jobs consume the products unit's artifact, cache the installed Playwright
version, and preserve actual status, signal, build id, wall and traces.
The old packed report that rebuilt a client is removed. Reporting does
not turn a failed test into passing qualification evidence.

On the same Ring-1 build f73a2132-mwih86b7, local receipts pass:
A 26.1 s (4 tests), B 54.0 s (3), C 16.8 s (3), D 55.0 s (5).
Discovery assigns 15 tests in 8 files exactly once. Five focused tests,
workflow lint, game lint, formatting and type checks pass.

The first D run exposed the real ten-connections-per-minute guard: the
reconnect scenarios plus two new entry pages spent one server's budget.
Entry failures now have a separate worker/server lifetime. The real
connection limits and strict console assertions remain in force.
Playwright worker fixture matching is documented in its upstream
`docs/src/test-fixtures-js.md`.

Hosted receipts and the three-day gate remain open. A global unbinding
of use also breaks B's door-save setup, so it cannot establish the
plan's originally stated A-only isolation.
