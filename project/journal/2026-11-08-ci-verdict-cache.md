# J192 CI1 and CI3

Push CI now keeps its running verdict; only pull requests cancel in flight.
The final coverage job ports singleplayer ff8d8e6be8's actual Actions/compare
queries, names every commit since the previous completed non-cancelled push
and annotates failures with that range. It depends on both current CI jobs.
Read-only Actions permission is explicit. No test or gate is removed.

The real query against failed run 42470548295 reports
8fb2aefc6b..54dfb6bdfa and its single asset-API commit. That check caught the
old printf/wc missing-final-newline bug; the port counts nonempty lines with
their newline, including one-commit and empty ranges correctly. Actionlint
and YAML parsing pass. Future bursts still need hosted scheduling evidence.

The check job uses the existing ring-setup composite instead of duplicating
setup. An optional cache scope preserves Ring 1's existing key and gives
the full 28-product reader its own immutable cache. Otherwise a three-pin
Ring 1 cache hit could permanently prevent publishing a complete full cache.
Each installer still verifies hashes/admission. E2E keeps its bare setup
because it never reads product pins. Hosted hit timing remains to measure.

Shared-file handoff: codex-mock may now build sharding atop these workflow
and action changes, preserving the coverage job and adapting its needs.
