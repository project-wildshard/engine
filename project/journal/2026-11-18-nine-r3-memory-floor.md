# Re-measure Nine's spawn floor

Written by Codex for the QA29 fix forward (J249, CI run 44435767608).

The phone-tier estimate after the play and ASTC projections was
531,740,579 bytes for revision 3. The test still used the 532.7 MB
ledger reading from the October 27 legacy preview.

The full pinned client built from `6b1ab2abee` with the corrected piano
manifest booted Nine revision 3 (`afd68ee2`) locally in Chromium's
402 × 874 phone profile at game scale 2×. KTX2 was active and ASTC
was supported. Twelve seconds after entering play at spawn, the engine
ledger read 166,081,624 GPU bytes and 34,719,433 RAM bytes, with no page
errors. Those totals supply the new floor. The test still requires
the estimate to cover the measured bytes after excluding Explorer assets.
