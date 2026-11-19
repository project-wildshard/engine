# STR25 optional client code on Nine

> Written by: Codex
> **State:** measured 2026-11-19 on engine `d099845f` (MEMORY-STRUCTURE M4, J430).

All builds used revision 3 of `nine-dragon-stack`, pin `afd68ee205f0`, and
format 0.46.1. Each pair booted the same pinned world online against a
fresh local Node room. The instrument was native WebKit minimal at
Phone Low (402 × 874 @3) on macOS 27.0 (26A425), Playwright 1.65.0
WebKit revision 2388. Pairs alternated control-first and omission-first.
The meter verified `engine/tmp/mini-measure.lock` against the descriptor
held by `lockf` before and after each arm. Every boot started in a fresh
browser and reached control without a standalone server worker.

Each omission replaces the selected client implementations at build
time. It retains shared wire contracts, authored world data, and small
registration shims where Nine uses a system during boot. The grapple
arm retains a normal equipment entry. The practice arm retains the
course registration call without installing the course. The weather arm
keeps shared network climate. These builds are diagnostic only.

[K] WebContent and GPU are settled process footprints from the kernel.
JIT [K] is the WebContent `JS JIT Generated Code` VM bucket from
`footprint`. [J] sums JSC `*CodeBlock*` nodes from a snapshot captured
after the settled readings. JIT and code blocks describe parts of
WebContent. Raw and gzip are the build's static session closure from
`.vite/chunk-modules.json`. Deltas below are omission minus control.

## Results

The control session closure was 4,401,090 B raw and 1,360,494 B gzip.
The meta evidence file `project/evidence/engine-memory/str25-nine-pairs-2026-11-19.csv`
contains the 96 verified boots behind the table.

| Omission | N | WebContent [K] (MB) | GPU [K] (MB) | JIT [K] (MB) | Code blocks [J] (MB) | Session raw (B) | Session gzip (B) |
|---|---:|---:|---:|---:|---:|---:|---:|
| all | 6 | -12.89 [-34.05, 9.37] | -2.02 [-5.49, 0.20] | -0.30 [-0.54, 0.20] | -0.41 [-1.24, 0.24] | -6067 | -2490 |
| boss | 6 | -9.14 [-46.65, 5.18] | 0.29 [-3.41, 3.03] | -0.11 [-0.51, 0.29] | -0.04 [-0.16, 0.24] | -4628 | -1788 |
| riding | 6 | -5.39 [-22.90, 21.41] | 0.41 [-2.62, 2.64] | 0.14 [-0.26, 0.21] | 0.02 [-0.12, 0.14] | -579 | -323 |
| grapple | 6 | -5.23 [-35.54, 1.05] | -1.88 [-3.10, 0.31] | -0.39 [-0.77, -0.02] | -0.34 [-0.40, -0.17] | -171 | -117 |
| stealth | 6 | -4.01 [-19.71, 33.08] | -0.63 [-2.05, 0.38] | -0.09 [-0.21, 0.11] | 0.04 [-0.08, 0.12] | -442 | -234 |
| weather | 6 | 3.94 [-11.08, 22.74] | 0.52 [-1.79, 1.70] | -0.03 [-0.38, 0.25] | 0.02 [-0.42, 0.11] | -288 | -234 |
| compendium | 6 | 2.91 [-14.61, 25.99] | -0.88 [-2.92, 1.97] | 0.18 [0.03, 0.74] | -0.06 [-0.10, 0.43] | -232 | 119 |
| practice | 6 | -1.17 [-59.42, 11.45] | -0.14 [-3.05, 1.52] | -0.10 [-0.33, 0.39] | -0.05 [-0.09, 0.01] | -252 | -254 |

The all-omitted build lowered settled WebContent in four of six pairs.
Its 12.89 MB median saving is below the 30 MB go line (J430), so the
system declaration and the session split close as below the go line.
The largest raw session changes were boss (4,628 B), riding (579 B),
and stealth (442 B).

The full build output contained 8,705,908 B of JavaScript. The
all-omitted output contained 8,376,008 B. The static session closure
fell by 6,067 B, consistent with most of the removed output already
outside the session closure. In the six all-omitted pairs, the settled
GPU ledger fell by exactly 7,954 B. The largest RAM ledger difference
was 2.92 MB, including 2.75 MB of ArrayBuffer backing stores.

## Repeat the read

Apply the meta repo's
`project/evidence/engine-memory/probe-scripts/str25-code-diet.patch`
in a clean engine plan checkout. Install the frozen lockfile and run
`pnpm pins`. The probe's files are under `tmp/str25`.

```bash
node tmp/str25/build-arms.mjs tmp/str25 \
  base all boss riding grapple stealth weather compendium practice
node tmp/str25/run-matrix.mjs tmp/str25 "$PWD/tmp/str25/pair.mjs" \
  /path/to/engine/tmp/mini-measure.lock 6 \
  all boss riding grapple stealth weather compendium practice
node tmp/str25/report.mjs tmp/str25 . \
  all boss riding grapple stealth weather compendium practice
```
