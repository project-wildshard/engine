# Exit to Title preserves the real hut door

The seated save suite uses an independent context for the Exit path, opens
the hut door through E, then clicks the visible game-menu Exit control.
Shard select starts the next entry and both the quest flag and physical
non-solid door panel return. The reload and Exit paths share their door
helper, but each tests a separate durable-save boundary.

Both browser checks pass in 57.3 s, with no console or page errors.
