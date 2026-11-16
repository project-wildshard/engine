# Share six suites with owned fixtures

> Written by: Codex

> **State:** built locally, 2026-11-16; HOW-WE-BUILD TS6l.

Six existing suites join the shared Node worker: frozen Nalati fixtures,
grid page URLs, native actor projection, hidden neighbour particles,
Simulator transport and Simulator lane. Their assertions and setup stay
unchanged. The source audit found read-only pinned bytes, owned URL inputs,
reaped native-loader children, disposed particle views and isolated fake
Simulator processes. No real Simulator runs.

The six cases pass alone and in exact forward/reverse shared orders with
an external page-scope balance assertion. Warm isolated child CPU was
4.812 s; shared orders used 3.344/3.412 s. These local observations do not
establish a full-gate saving. The maintained shared project also passes
with shuffled seeds 7 and 73 after allowlist adoption.

Exact inventory, source audit and measurements live in meta's
HOW-WE-BUILD vitest-bench/SHARED-REMAINING-20261116.json. Identity,
browser-host, strings and storage setup remain installed for every file.
