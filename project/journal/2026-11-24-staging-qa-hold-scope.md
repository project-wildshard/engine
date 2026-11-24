# 2026-11-24 staging QA holds (J505)

v0.1.77 failed Nalati on staging while v0.1.78 carried the fix. The old HOLD receipt told people to stop unrelated cuts. Keep the P0/P1 promotion gate on the failing build and limit any staging publish pause to the colliding revision for 30 minutes.

The release command prepares and proves each version independently. It takes the shared staging lock after exact CI, so another run can cut a fix while staging is occupied. The regression test covers the hold receipt and admission of the fix under its own verdict.
