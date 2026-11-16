# Load the authored variant skin

> Written by: Codex
> State: built locally, 2026-11-16; M1 land pending.

The existing skin loader consumes the format resolver, loads each unique skin
once per look and retains exact variant ids. Each instance selects its geometry,
rest joints and clip driver at construction. Material and rig contracts remain
shared as checked by format admission; the frame path keeps its existing driver.

The two-variant binary fixture proves geometry, sampled animation, shared aliases,
unknown-id refusal and exactly-once scope disposal. Existing material controls
still pass. Full types and game lint also check the earlier simulation receipt
script, now with explicit JSDoc parameters and checkpoint types.
