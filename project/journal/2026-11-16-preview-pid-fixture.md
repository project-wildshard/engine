# Keep foreign fixture PIDs distinct from the test process

TC47 supporting CI triage: the shared preview fixture used 12345 as
a different process. CI gave its Python process that PID, so both the
replaced-row and stale-identity controls silently became matching rows.
The result was a MagicMock return code and a missing expected refusal.

Forcing os.getpid() to 12345 reproduces both exact hosted failures.
Derive the foreign PID from the actual fixture PID instead. All sixteen
SharedReleaseTests pass under the forced collision; the unchanged
eleven-case partition also passes normally in 6.074 seconds. No lease
implementation, deadline or assertion changes.

Four other hosted failures already occur on main 0445210e and 028d1bec:
Template collider parity, poison damage, declared rack and kit inputs.
Those unchanged tests stay visible and keep this branch unqualified.
