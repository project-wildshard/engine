# Session raw back under its cap (mini-em1c, 2026-11-17)

Main run 44223225880 (c4397636) failed boundaries on hosted Linux: the session closure was 4,400,308 raw bytes against a
4,400,000 cap, while the same tree built locally to 4,398,835 (hosted runs about 1.5 KB higher). ENGINE-MEMORY EM9 had put
the ledger on every boot checkpoint, which grew bootTrace.

- Two pieces that only run on demand leave the closure. bootTrace's report sending (the inbox and Sentry half of
  `flushBootReports`) moves into `telemetry/bootInbox.ts` (the inbox send's lazy chunk), imported only when an interrupted boot is queued, so a clean page
  never loads it. Perf's probe-report header moves into `perfProbe.ts`, which the PROBE button already imports; the
  header is still taken before the rows switch anything off.
- Local session raw is 4,397,158 after this, about 1.7 KB under the c4397636 build.
