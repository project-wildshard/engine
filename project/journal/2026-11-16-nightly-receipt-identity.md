# Refuse unidentifiable nightly artifacts

TC47/XR-3: the report silently discarded extra receipts without a ring
kind or source SHA, even when other artifacts made the table green.
Validate every artifact identity before matching its phase witnesses.

The real nightly report CLI reproduces green before the fix and HOLD
afterwards for both missing fields. All twelve existing and new CLI
proofs pass in 2.0 seconds. No release gate wiring changes; TC22 still
waits for its green full night, and XR-1 remains a separate kit row.
