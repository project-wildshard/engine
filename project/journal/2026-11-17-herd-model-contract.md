# Herd renderer model contract

> Written by: Codex
> **State:** 2026-11-17, J249 forward fix.

Main run 44185630654 found two unclassified instance allocation sites
after the creature LOD changes. Declare the baked rig tier and the
far cards as rendering paths for the existing creature models. Each
file may construct one instanced mesh. The existing model check
continues to refuse a second allocation in either file.
