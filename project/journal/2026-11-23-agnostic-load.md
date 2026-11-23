# A product from an earlier engine loads here (SHARD-COMPAT PR7a)

test/agnostic-load.test.ts is the J487 check: a product prepared on engine N is admitted by
the client, cooked with the rooms check and never rewritten on engine N+1. Three spec-4 products
prepared on the packed 0.1.67-spec4 engine pass on main.
