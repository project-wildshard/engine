# Nalati taming budget

> Written by: Codex
> **State:** 2026-11-17, QA-mini20 / J295 forward fix.

The original field approach spent 7,082 ticks chasing a frightened stallion.
Its pilot repeatedly returned within the herd fear distance before earning
trust, keeping alert at 100 and starting more flight. Changing the starting
offset or crouching throughout did not help; those experiments were reverted.

The pilot now offers from 10.5 m until the public trust gauge reaches 60,
then approaches for the actual mount prompt. It retreats through ordinary
movement inputs when too close, crouching inside the native slow-approach
range. No trust, alert, horse, quest, physics or save state is written.
The same 3,857-tick spawn walk and original -3/-3 approach start remain.
The measured approach takes 2,162 ticks; local complete case 17.804 to
9.220 seconds. All original assertions, finite input bounds, restore checks
and the 60-second file budget remain unchanged. Both field legs are checked
before push; exact hosted budget proof is recorded in meta QA-mini20.
