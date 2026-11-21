# Pine r9's loading memory, from three reads

buddy-engine, 2026-11-20, ONE-FORMAT OF23f.

`9bf9ad2ca6` recorded Pine r9's loading memory from one push read,
1.071 GB. A push's memory-footprint run reads each zone once, and
Pine r8's single reads today spread from 1.033 to 1.164 GB, so one
read is not a baseline. The three-read budgets run opus-pine9
dispatched (44839678095) reads the ledger three times but carries no
`memory/` keys, and memory-footprint.yml has no three-read dispatch.

So the three reads come from three push runs at `pine-hollow@9`:
44839577732 (1.071 GB), 44843032903 (1.061 GB) and 44848198884
(1.063 GB). The baseline is now 1.063 GB, 0.7% under the one-read
value and still well under r8's 1.317 GB raise.
