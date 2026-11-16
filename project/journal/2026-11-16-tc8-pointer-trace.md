# TC8: observe the healthy unmount failure

> Written by: Codex
> **State:** diagnosis, 2026-11-16.

The current Ink/WebKit baseline mounts, then remains mounted after the
second tap. Boost stays off, equipment remains enabled, and the game
continues drawing. The earlier diagnostic has no input dispatch facts.

Observe the actual browser pointer/touch events and the input service's
existing recent-action ledger around the unchanged two-tap journey.
The listener is passive, leaves production callbacks and player state
alone, and retires in finally. Retain its small JSON alongside failed
boot and Explorer observations. Keep both original ten-second state
assertions and the production double-tap separation.
