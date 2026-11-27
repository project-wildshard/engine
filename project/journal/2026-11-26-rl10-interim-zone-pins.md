# Pin the interim Nalati and Nine Dragon cooks for v0.1.99

Staging cooked Nalati 0.0.10 at upload 11 and Nine Dragon 0.0.11 at
upload 12. Both replacement Ring 1 slices pass the retained 240-tick
chain. The staged v0.1.98 server cooked these interim heads. The current
page alias serves an older build, so the coordinator scoped the pins to
the v0.1.99 candidate and its strict exact-build pack checks.

The main-push pre-lock gate dropped the FS18 provenance marker. The
coordinator authorized ALLOW_PIN_PUSH=1 for this release pin batch.
The clean gate and exact hosted CI still prove the combined source.
