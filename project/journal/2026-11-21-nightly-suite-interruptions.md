# Explain incomplete nightly suite runs

An interrupted partition now records the child process signal or start
error. It keeps that evidence even when Vitest writes a partial report.
The verdict distinguishes that case from an assertion failure and still
holds on missing partition and listed-test receipts.
