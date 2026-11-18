# The ledger dumper drains through control

The qualification run 44255220814 got every zone to control on hosted
Chromium (Nine now reads in native WebKit). The ratchet then threw
`Boot did not record a control ledger`.

Three readings said `ready: true` and still ended at `data`:
ember-forge 2, jungle-ziggurat 2 and 3. The microscope's dumper asks
for one detailed memory dump per boot step, one after the other. On the
hosted runner a detailed dump is slow, so the dumper fell behind the
page. Control came 1.5 s later and `run.on = false` stopped it, so
every step it hadn't reached was dropped. That included `control`, the
step whose ledger the ratchet reads.

Once the page is at control, the microscope now waits up to 120 s for
the dumper to reach the `control` step before it stops. The ledger in
each row is the one the page recorded at that step, so a late dump
doesn't move the ledger figures. Only the process footprints are
sampled later.

If the dumper never gets there, the reading fails and names the last
step it dumped, not a ratchet error later. Locally, with a 1.5 s delay
added after every dump, `_template` still ends at control with 14
checkpoints.
