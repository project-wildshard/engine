# DF10 keeps the dock in the route frame log

> Written by: Codex (codex-tc48), 2026-11-23

A full Driftwood route runs longer than the last 4,000 frames. Keep each
selected frame and its predecessor at capture time so both the first dock
stall and a late road stall survive. Count frames and keep the first time
stamp independently of the selection. Count byte lengths of buffer uploads
from the source slice, including the WebGL2 bufferSubData overload used by
the far indices.
