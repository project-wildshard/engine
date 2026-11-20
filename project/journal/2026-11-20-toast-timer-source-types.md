# Type the slotted toast timer in both runtimes

Pine's CI21 imports engine source with Node and DOM types together.
TypeScript inferred the timer as the literal zero in a chained
assignment, then refused the scope's Node timer handle. Declare the
slot's type before storing it. The two timer callbacks and teardown
keep their existing behavior.
