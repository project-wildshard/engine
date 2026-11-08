# The actual cooked store reaches all three games

Written by: Codex. 2026-11-08. P2.

Runtime source bd20c9b boots the Template-only normal build and attaches
the actual cooked Blender and Dunes pins with addStoredShards. All three
reach gameplay: 6920, 5277 and 6627 ms. The final assertion now executes:
all nineteen fetched store objects belong to the actual cook indexes,
including seven packed parts. No console or HTTP exception is allowed.

The two new fixes are transport/data facts: declare optional-file absence
from the actual index, and fetch loose mounts beside their manifest's
parts. A present Dunes programs file still arrives from the store. No
renderer, linking algorithm, image or UI work was needed. Enable this
complete cold proof in the report-only push/scheduled CI soak. It remains
Ring 2 because a clean client build and cold q11 cooks exceed ten seconds.
