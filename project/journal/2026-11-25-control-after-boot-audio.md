# Control waits for the after-boot audio

Meta QA 11-25 row 72, opus-fr13. Nalati's control ledger read 2.6 MB or 23.0 MB of audio on the same client:
the boot decodes audio after control (finish.ts decodeAfterBoot) and the Chromium ledger read control at the
first draw, racing it. The session now exposes the after-boot audio state and measure.mjs waits for it before
its GC and read. The 18 control budgets with after-control audio (Nalati, the open plots) are declared, so the
first main budgets run after this records their settled values (J444).
