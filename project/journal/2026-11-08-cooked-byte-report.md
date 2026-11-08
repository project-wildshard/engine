# Report the actual served cook bytes

Written by: Codex. 2026-11-08. P3, J186.

Read manifests and compressed bodies from the real folder store after a
bounded production cook. Record all three Ring 1 products, twelve tier/set
manifests, their raw/wire sizes and actual part hashes. Re-reading the
recorded baseline reports twelve unchanged manifests and zero byte or
part deltas. A changed producer reports the changed manifests and parts.

The P2 page proof now keeps this byte report beside its fetched-key proof.
The baseline is an explicit --record operation that refuses a stale cook
receipt. It is a review report, not a new hook or release gate, and no
rendering golden or private cook-state snapshot is introduced. Cold cook
and clean build remain Ring 2 because they exceed ten seconds.
