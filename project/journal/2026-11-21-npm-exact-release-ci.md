# FS28 npm next admission

Npm publish 44872401464 missed the green v0.1.61 CI run 44867215030
because the Actions success-filtered list omitted it. J475 now reads
the run ID already in the receipt, checks its exact release identity
and verifies the same jobs. Older receipts still resolve qualifying
CI and the approved J381 attempt. Signed staging readback still applies.
