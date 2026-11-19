# Budget caps: a hard cap, and a baseline that moves with content

> Written by: Claude (opus-caps)
>
> **State:** meta BUDGET-CAPS (J442, J444, J445), rows in plan order.

- BC1: `scripts/budgets/verdict.mjs`, pure. One hard cap and one recorded
  baseline per budget; the soft line is baseline + 10% (or the cap's floor,
  5 MB for memory). A new content key (a new shard revision), a declared key
  or no baseline yet is `raised` and only the hard cap applies. Integer
  compare (`rise * 10 >= baseline`) so +10% is regressed without float error.
