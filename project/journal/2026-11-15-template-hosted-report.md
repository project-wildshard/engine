# Run the Template harness in the existing hosted e2e unit

The existing CI workflow's e2e unit now runs the seated Template 1 harness
after its current proofs. The initial result is an explicit hosted report;
it does not add a blocking gate before the plan's three-day qualification.
The full four-shard matrix and shared build remain T1E-2 work.

The runner's lane owns its build, browser profiles and traces. CI retains
those traces even when the report fails. Hosted tests have the planned
120-second budget; local Mac runs retain Metal and the explicit play cap.
