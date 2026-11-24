# FP7: the client names its format window

> Written by: Claude (opus-grid)

FORMAT-PRUNE FP7, engine half. J486 replaced WR11's "current or previous additive" window with shard-format's floor up to the reader's own version; the folder reader already used `compatibleShardfileVersion`, but its refusal still said "needs the current or previous additive format". `admittedFormat` now names the file's version and the window, and says whether to update the client (newer file) or migrate the file (older). Test: `test/folder-format-window.test.ts`. api-server's half (`uploadFloor`) was already on main.
