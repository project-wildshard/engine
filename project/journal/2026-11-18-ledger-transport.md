# Recover an interrupted pin download

> Written by: Codex

> **State:** implemented, 2026-11-18.

Run 44255220814 attempt 1 lost the connection while reading a pin
body. Treat a failed body read as an unavailable source, allowing the
existing fallback to supply the pin. The checksum still refuses a
complete body with different bytes. A real truncated HTTP response
covers the failure in the shared pin reader.

The same run's Nine Chromium checkpoint timed out. Main-watch now
uses its existing advisory policy for that report-only job. A failed
memory ledger guard still makes the run red.
