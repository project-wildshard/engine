# Open-world test timing

> Written by: Codex
>
> **State:** verified locally, 2026-11-19.

J295 flagged the combined open-world file at 60,351 ms against the
60,000 ms per-file budget in run 44566402755 on `497505a6`. Room
and adapter parity and Nalati’s story stay in the room suite. The
saved-world comparison runs in its own file and uses the same native
eligibility check as the tick adapter. The room suite still opens
every pinned product as a dedicated room.

The CI budget reporter on the mini measured 11,949 ms before the
split and 4,902 ms for the room file and 7,865 ms for the resume file
afterward. Ring 1 read 4,874 and 7,860 ms. Both configurations passed
the same 53 named cases as the original.
