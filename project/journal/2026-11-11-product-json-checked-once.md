# A product checks each named JSON once

> Written by: Claude (opus-testspeed-lane)

TEST-SPEED TS4 (J255 Q8, "fix for everyone and everything"), in profile
order after snapshot encoding: valibot re-validation. In
`engine-rule-successors-titan` Valibot was 3.2 s of 29 s sampled CPU.
Most of it was `ShardProduct.json()` re-running `validatePlatformFile` and
`validateRegisteredJson` on the same named file every time a resident
opened, though the product and its verified reader never changed.

Both checks only read the decoded value, and the product's reader decodes
the same hashed bytes each time. So a name that passed once for a
product passes again: the product now remembers the names that passed and
skips the repeat. A refusal is never remembered. A new product (another
shard, another build, a hostile fixture) starts empty. Reads still parse
fresh values, so no caller shares an object it could mutate.

Measured on the Mac, alone, one worker (vitest-bench, before 8a965bd6 →
after):

| File | CPU-s | Wall |
|---|---|---|
| engine-rule-successors-titan | 21.96 → 17.77 | 14.5 → 11.4 s |
| engine-rule-successors | 9.39 → 8.13 | 5.9 → 4.9 s |
| headless-combat | 9.28 → 7.99 | 6.2 → 5.1 s |
| net-fuzz | 15.76 → 12.61 | 12.2 → 9.8 s |
| wind-elite-room | 13.25 → 9.67 | 9.2 → 6.3 s |
| nalati-awareness-verbs | 31.53 → 26.33 | 18.1 → 14.7 s |

Players: loading a Nalati save into a resident on an already-loaded
product went from 672-725 ms to 367-415 ms; Driftwood 73-79 → 68-72 ms.
Saving is unchanged (684 → 663 ms, noise). The first open of a product
(cold boot) still checks every file.

Review (J206): a custom `jsonCheck` may decode the same bytes differently, so
the skip now applies only to a pure decoder: plain JSON, or a checker marked
`pure` (the default `readCheckedNamedJson` and `nodeNamedJsonCheck`), keyed by
name and hash. `test/product-json-checked-once.test.ts` proves a checker not
marked pure is re-checked and a refusal is never remembered.
