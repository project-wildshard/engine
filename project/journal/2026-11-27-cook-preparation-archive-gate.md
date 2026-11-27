# Check the preparation archive before moving the cook

QA51. Staging signed v0.1.100 before the preparation-client job had
attached its archive. The VPS started the cook move, then restored
the earlier worker when the new archive returned 404.

The release command now checks the exact staging tag's archive
before touching the box. A missing or unreadable archive names the
asset and the job to check. The test covers that refusal, archive
availability and check ordering.
