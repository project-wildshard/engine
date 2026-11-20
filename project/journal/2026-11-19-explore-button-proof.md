# Activate Explore buttons with the keyboard in CI

> State: release fix for v0.1.53, 2026-11-19.
> Written by: Codex

Main run 44639034030 reached the Explore hub's visible Back to zones
button and ran out of time during the pointer click. The preceding five
in-world clicks took about 74 seconds. Their Playwright trace shows
repeated frame and scroll waits while software GL draws the scene.

Use Enter on the same visible, named button controls after world load.
The list still uses a pointer click. The journey still holds W for
flight, opens a model sheet and returns to the zone list, within the same
120-second test budget.
