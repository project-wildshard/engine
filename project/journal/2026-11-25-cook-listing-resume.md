# Cook restart resumes its bucket listing (FAST-RELEASE FR-A21)

- opus-cook: each cook restart relisted the whole pack bucket before its first publish (929 s and 963.5 s on the box,
  11-25). The worker now saves its kept listing beside the scratch folder (`keptListing.ts`: a header plus one
  `modified bytes key` line a row, PUTs appended to `<file>.puts`) and a restart serves it for up to 6 h while a fresh
  listing refreshes it. Safe because a PUT is still skipped only for a key written in the last GC_GRACE_MS / 2.
- Surprise in the test: with an injected clock near 0, a key missing from the listing (modified 0) reads as current, so
  the test clock starts at 500 min.
- Keys decode from their own bytes (FR-A16's lesson): a restored row keeps 213 B of heap; 200k rows load in 97 ms.
