# A memory meter to trust (mini-em1, ENGINE-MEMORY M1, 2026-11-17)

Jake (~18:45 Cancún) asked for memory measured from first principles. Meta's ENGINE-MEMORY plan makes kernel
`phys_footprint` of Playwright WebKit's WebContent and GPU processes the truth meter on the Mac, the engine ledger the gate,
and Chromium allocator dumps attribution only. Milestone 1 builds that meter.

- EM2, one kernel reader (`scripts/memory/footprint.{py,mjs}`). The surprise: Playwright WebKit's WebContent and GPU
  processes are XPC services parented to launchd, so the old "new since before" `ps` scan reads whichever lane's WebKit
  started last. The kernel's responsible pid (`responsibility_get_pid_responsible_for_pid`) ties each one to the Playwright
  app this Node process launched. The sampler resets the interval high-water after every read, so a 20 ms sample carries
  the true peak since the previous one. The watchdog, sim phases and load-mem-probe now read through it.
