# The gate only needs Brasscap for its strike test

Engine CI run 44504623966 passed both stale-preparation groups from the previous red. Its tests (8) group found one more stale expectation after the same Template-to-Brasscap fixture move. The strike test consumes the Brasscap product. The gate's disk selection already returns just that product. The test still expected it to fetch `_template` as well.

The expectation follows the strike test's current dependency. The independent headless scenario still checks the full product set, including `_template`.
