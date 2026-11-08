# Reuse before waiting for another full-test lease

The real queued 80d5cc0 gate passed all 5,818 cases in 285.7 seconds and
saved proof 0ff14781-8671-40f0-920d-b1b61d671c6d. Git's normal hook then
waited five minutes behind a later full-test owner before it could read
that proof. The push did not publish. No failed/partial proof is reused.

Normalize the same declared gate environment and actual scheduler root
before and inside a lease. After the unchanged outgoing history/secret
scan, read a clean exact-tree/runtime/covering-scope proof before asking
for resources. A hit names its original run and starts no heavy work. A
miss keeps the existing authenticated lease, all generation/static/tests,
final clean-tree capture and proof write. CI still never reuses. The
ephemeral compatibility root/token remain excluded; the real root stays.
