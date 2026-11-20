# Keep Ring 1's simulation digests through snapshot v6

Snapshot v6 changes two version fields on every wire, even in a world
that never queues a victory credit. Ring 1 compares the original version
5 headers so the old baselines still catch movement, AI and physics drift.
The exact rest of each wire, including any pending credit, stays hashed.
