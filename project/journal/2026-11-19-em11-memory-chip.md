# Show EM11 and the sampled boot peak in the mem chip

> Written by: Codex
>
> **State:** implemented 2026-11-19. Device comparison queued with mini-phone-queue.

The chip reads EM11's central playing estimate from the same live ledger as
the subsystem panel. It identifies the estimate or the available fallback.
The expanded panel gives EM11's playing upper and the crash-line reference.

With Developer enabled before boot, the loader retains ledger totals at
checkpoints, stage changes and control. The peak is the largest EM11 central
estimate across those samples. The samples already cover loading, so the
settled-to-load multiplier does not apply. The chip keeps the peak after
control and shows when no boot sample was taken. Developer off leaves the
existing crash trace and entry trend in place with no new sampling or timer.

Safari's screen dimensions identify a device class. Keep the 17 Pro's
2048 MiB reference for the matching class. The 390 by 844 iPhone class reads
unmeasured until IP7. Compare Nine and Pine against sysmon on the same
iPhone 13 boots, with Developer enabled before navigation.
