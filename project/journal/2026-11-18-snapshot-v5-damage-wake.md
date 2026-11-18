# Snapshot version 5 for the damage wake

opus-of-m2, 2026-11-18. Rebasing ONE-FORMAT M2 onto main (format 0.35) met main's saves lock: OF26e2 had put an
optional `damage` mark on the brain band clock in the persisted `sim.snapshot` with no version bump. The contract is
now version 5 with migrate[4]; a version 4 save reads up with no wake mark, so its next hit wakes the brain as before.
The new layer-interest wire case failed first on version 4.
