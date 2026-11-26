# A skew refusal says what staging lacks

> Written by: Claude (opus-pvclient)

Fix preview PV18. When preview's deploy refuses because main's cook version is not the one staging's release cooked (PV2), it
appends one BLOCKED line to the lanes' receipts log: both cook versions, staging's serial and build, and the files under
`src/cook` that changed between staging's build and HEAD (`git diff --name-only`). A release lane reading the receipts sees
preview waiting on it. `WS_RECEIPTS_LOG` points the line elsewhere; the test writes it to scratch.
