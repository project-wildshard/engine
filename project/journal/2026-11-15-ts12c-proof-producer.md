# Preserve a proof's actual producer

> Written by: Codex
> **State:** built locally, 2026-11-15; unpushed and unlanded.

TS12c adds optional measurement metadata to v2 push proofs. Capture uses
the same Darwin/Linux kernel identity backend as the observer, with two
stable owner snapshots. A read-only owner query neither samples CPU nor
writes a report. A mismatched expected owner refuses.

The receipt retains the actual gate profile, owner identity, machine and
capture time. A current full-test lease contributes its token, processes,
resources and lifetime only after the existing ancestor/token check.
Missing kernel or lease evidence stays null. These fields never alter
runtime fingerprints, selection, admission or cache coverage.

Reuse returns the original producer, run and finish time. Old receipts
without metadata still reuse. Docs/related selections retain their modes;
a split full selection retains split-v1. None becomes a fresh full census.
Exact qualification and command-only rusage remain TS12d/e.

Real Git/kernel fixtures exercise owner and lease binding, wrong-owner
refusal, producer-preserving reuse, legacy compatibility, partial scope,
split profile and wrong-token unavailability. The lease marker is an
owned fixture, not a claim that a scheduler gate ran.
