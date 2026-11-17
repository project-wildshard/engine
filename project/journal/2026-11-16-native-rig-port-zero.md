# Native database rigs keep the OS-assigned TCP listener

DS20b2 extends the owned instance endpoints to native PostgreSQL. A real
PostgreSQL 18 control rejects `-p 0` (valid range 1..65535). Instead of a
probe-and-release race, a TCP front retains its actual port for the fixture's
whole lifetime and forwards to a Unix socket in the fresh database directory.
PostgreSQL listens on no TCP address. Its socket's numeric suffix is private
to that directory; it reserves no named machine-wide port. A short relative
socket path also works when the worktree's absolute path exceeds macOS's Unix
socket limit. There is no external database or port-allocation registry.

The key and fresh-directory admission still precede any owned mutation.
Postmaster data/port identity checks and the connected data-directory check
remain before DROP DATABASE. Legacy named-port behavior is unchanged.
Closing the rig drains its world, closes client/front connections, then stops
only its owned database. Startup refusal closes the newly owned front.

The red-first full native rig failed on the explicit unimplemented-zero guard.
The repaired proof starts PostgreSQL 18, connects through the returned TCP URL,
checks its actual data directory, writes SQL data, restarts the world and reads
that same data back. It verifies every memory/native endpoint is distinct and
that database stop removes its postmaster PID. Existing foreign-directory,
private-key, occupied-listener and connection-identity refusals remain tests.
CI discovers installed native server binaries (or explicit FAILMODE_PG_BIN);
missing binaries fail the qualification instead of silently skipping it.
