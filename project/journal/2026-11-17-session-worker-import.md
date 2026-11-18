# One lazy import for the worker client

> **State:** forward fix for the session bundle, 2026-11-17.
> Written by: Codex

Engine CI 44203996278 stopped in the cook-to-play build at 4,400,125
raw session bytes against the 4,400,000-byte cap. The Rapier prespawn
from 69d4b822 added a third lazy import of the same worker client.
Each call site emitted its own import and Vite preload dependency list.

Prewarm, early server start and adoption share one lazy importer.
Prewarm still starts in the data stage with the same held byte reads,
and both speculative starts defer errors to the final server step.

Paired local production builds with the boundary's Template catalogue
count 4,398,636 to 4,398,303 raw session bytes (333 fewer), and
1,359,293 to 1,359,173 gzip bytes. The emitted session has one worker
client import, down from three. The raw and gzip caps stay unchanged.
The prespawn, warm physics, route, entry and memory tests pass (23).
