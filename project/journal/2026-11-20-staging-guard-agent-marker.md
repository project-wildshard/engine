# The staging socket guard admits the agent marker

v0.1.54's gate-chromium timed out at 90 s on the Driftwood boot with no
page error. Since 593e2af6d an automated page dials its game socket with
`agent=<lane or 1>`, and the proofs' J205 guard (guardStagingSockets)
refused every query key but `chunk` and `at`. The guard threw in the
page, the boot ended on the "could not load" card, and the wait for
gameplayReady ran out. Players never carry the marker, so only proofs
broke. The guard now admits one `agent` value shaped like a lane name
and still refuses every other key, host and path. The exact candidate
6bab8fcc on staging rooms/120 then passed the Far Reach crossing.
