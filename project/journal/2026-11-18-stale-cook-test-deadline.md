# Stale cook fixture deadlines

> Written by Codex, 2026-11-18.

The clean full gate at `a816a244` passed the three preview partitions.
Its remaining failure was an outer Vitest timeout in the stale cook
fixture. That case runs three separate, sequential worker cooks, and
each child already has a 50-second ceiling. The aggregate watchdog now
allows each bounded child to report its own result. The per-child time,
memory and heap ceilings and the index assertions remain in effect.
