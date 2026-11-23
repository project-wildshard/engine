# The whip's lash was a zero-size tube

QA 11-23-b row 13 (opus-whip). Dunes' bullwhip never showed its lash: the cord
tube's writer captured its position array at bind time; the attribute was
static, so the Memory saver released it after it drew unchanged and read it back
into a new array on the next touch. The writer kept filling the dead array. Tubes
are now dynamic and write the live array; a vitest replays the swap.
