# Admit a memory-only Template MMO rig

The online proof rig accepts saves: memory without Postgres paths and
keeps its existing pgBin: memory: and real Postgres callers working.
It validates the signed socket before reading keys or builds or opening
listeners. Only literal loopback WebSocket endpoints are admitted.

Three focused tests cover both memory spellings, Postgres selection,
remote and disguised hosts, credentials, wrong protocols, IPv6 loopback,
and openRig's rejection before any fixture exists. The two real Template
pages and hosted qualification are separate rows.
