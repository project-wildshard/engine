# Phone subsystem budgets

> Written by: Codex
> State: implemented 2026-11-17 (ENGINE-MEMORY EM33)

The budget allocates the G65 playing envelope of 1,000 decimal MB. The
allocations are targets. The ledger fields are raw capacity, and EM11's fit
projects their combined native cost.

| Subsystem | Phone MB | Ledger |
| --- | ---: | --- |
| Browser and framebuffer | 30 | Blank WebContent and default drawing buffer |
| Engine and render targets | 310 | EM11 fixed engine cost and renderbuffers |
| Workers and Wasm | 80 | Worker-owned rows and page Wasm |
| GPU geometry | 150 | WebGL buffers |
| GPU textures | 105 | WebGL textures |
| CPU geometry and colliders | 60 | Tagged CPU geometry and physics storage |
| Audio | 35 | Web Audio buffers and owned PCM |
| Loading and decode | 170 | Wire, scratch, decode, general backing stores and decoded images |
| Margin | 60 | Unallocated headroom |

EM4 measured 16.5 MB blank WebContent. EM11's zero-ledger model yields
262.6 MB centrally, so most of the engine allowance is fixed cost. EM8
found that labelled GL and page/worker RAM need different weights. The
table reserves separate ceilings for the resulting GPU and CPU pressure.
The engine classifies worker-owned bytes by their existing isolate prefix.
The projection fails on an unclassified entry so a new allocator needs
an explicit budget assignment.
