# Share return module loans for perch and native rows

OF22b1 found that a declared perch and the native return inventory can
lend the same Wasm to the same host under two row IDs. The second loan used
to compare the entire list, including IDs, and refused the host.

The host now retains both sets of modules in its original asset map.
Matching byte contracts share the module by hash. A mismatch in side,
ABI or resources names both declaring rows and the conflicting field.
Each running program still admits its full declaration in its own scope.

The regression constructs both loan paths with the actual perch fixture,
observes it using the existing instance, and verifies that a refused
contract leaves the previous inventory intact.
