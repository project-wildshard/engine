# Put steer HUD classes under the quest stylesheet owner

> Written by: Codex
> **State:** 2026-11-17, main forward fix during NP3.

Engine run 44177519993 caught the steer classes introduced by
`e4ea38e3` under quest.css. The CSS gate requires the owner prefix.
Rename the classes in the HUD markup and the stylesheet together.
The exact check went from 26 CSS errors to passing.
