# Keep first admission across removal and rename

The actual policy CLI accepts both removing/re-adding an entry and renaming its
tracked test with a fresh timestamp. Real Git proofs reproduce both false
acceptances. A third proof shows a recorded J200 extension is ignored.

History now keeps the first admission and original deadline forever, follows
actual Git rename ancestors, and never overwrites either on re-admission.
J200 is explicit: optional extension contains reason, grantedAt, decidedBy and
deadline, at most48hours after the original deadline. Its first committed
decision is immutable, including after removal/re-admission/rename. Removing
the extension metadata while keeping/re-admitting its file also refuses.
Only the effective deadline changes active selection; expiry still blocks.

All three real CLI/Git probes now pass, as does the original hour49/forged-date
proof. All nine current entries pass their first-history check unchanged.
No extension is granted here and no policy entry or original deadline moves.
The policy owner alone records any future reasoned J200 decision.
