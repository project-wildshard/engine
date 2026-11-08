# Bind a slice to its real head and current read set

Written by: Codex. 2026-11-08. P4, J186.

The real Ring 1 installer accepted a slice whose from hash had been changed
to sixty-four zeroes in an owned export. It still printed green for all
eight inputs. Bind that artifact to the actual pinned head before use.
The same real input now refuses with a re-cut instruction. Restore the
published metadata and all five slices pass actual inventory/hash checks.

At Ring 1 installation, derive today's server inventory from the retained
full index and verified sections in the slice, then check every required
body and reject extra bodies. This catches a changed reader without a
source-text golden or importing art. No artificial revision constant.

The Ring 2 verify-slices command re-cuts all five actual pinned raw heads
through the production serverRows/writeTar path and matches their published
slice hashes. All five match, 136.0 MB, from 751.7 MB of raw heads. It
writes no new pin, tarball or bless. Scheduled/manual report CI runs it;
the full raw-head reads stay outside the Ring 1 push budget.
