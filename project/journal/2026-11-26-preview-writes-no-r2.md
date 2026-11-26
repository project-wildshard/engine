# Preview's deploy writes nothing to R2

Fix-preview PV13, opus-pvpage. Jake: "preview deploy github action should not write to R2." preview.yml
dropped `--content` and its three R2 keys, so the page goes back to the preview Worker's static assets
alone, as before PZ6. The flow stopped signing `releases/preview.json` and no longer waits on a gate of
preview's own (`ownGate`): preview follows staging (QA 11-26 row 9), and PV2 (opus-pvclient) brings the
check against staging's release. The signing key stays: the build still signs code-retention.json.
test/preview-workflow.test.ts fails on a `--content`, an R2 key or a preview release write coming back.
Preview stays disabled until PV23.
