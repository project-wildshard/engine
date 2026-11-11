# Admit the bounded producer, keep the uncapped proof alone

Pine's public e1946bc producer now forwards the smaller actual host grant
to the credential-free cook child and limits concurrent q11 workers to
grant minus one coordinator. The setup-side holder still reserved the
entire sixteen-slot machine and exposed no WS_CPU_SLOTS to that file.
That prevents the already bounded producer from sharing its spare cores.

The explicit cook-admission-proof --worker command first runs all original
23 cold/warm/security/HTTP/budget/terminal/transient cases green in30.99s,
then fails the observed four-slot admission assertion. It is manual Ring 2:
the original real cold cook cannot fit a ten-second new-case budget.
No test body, input, count or individual deadline is changed.

The versioned local profile now reserves four slots for cook-worker and
sets only that file's WS_CPU_SLOTS to its actual returned grant, not an
unbacked constant. Teardown restores the prior environment after the
file's own cleanup, with an exit fallback. This is the published producer
contract, not a Vitest outer-worker variable claimed to limit native code.
net-bots and cook-cpu-limit remain all-slots: the latter deliberately tests
the unchanged no-grant machine-wide encoder default. Ten outer workers,
four builders and both lint budgets stay unchanged.

The same original23 cases pass afterwards in34.55s / 34.597s total, with
5919 actual scheduler samples all showing four slots. The isolated file
is slower than its31.0s baseline; no speedup is credited. Only a complete
unchanged full-gate measurement can show whether its newly available
cores shorten the critical path. That measurement/publication is held
through port's next v0.1.4 tag window. HS8's full native census, the nine
quarantine streaks and the three-minute full target remain open.
