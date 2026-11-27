# 2026-11-26 — Keep portable Math first on the solo worker

PV7 put its new type import before the worker's portable Math import.
The hosted entry-order guard flagged serverRuntime in run 45927847877.
Put the type with the other imports. All 51 portable Math tests pass.
