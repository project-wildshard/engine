"""Expose independent unittest fixtures to the ordinary Vitest file scheduler."""
import unittest


def run_partition(module, specification, *, verbosity=1):
    index, count = map(int, specification.split('/'))
    if not 1 <= index <= count:
        raise ValueError('Invalid test partition')

    def cases(suite):
        for test in suite:
            if isinstance(test, unittest.TestSuite):
                yield from cases(test)
            else:
                yield test

    # Include future cases automatically, without a separate inventory to drift.
    suite = unittest.defaultTestLoader.loadTestsFromModule(module)
    selected = list(cases(suite))[index - 1::count]
    if not selected:
        raise ValueError('Empty test partition')
    result = unittest.TextTestRunner(verbosity=verbosity).run(unittest.TestSuite(selected))
    raise SystemExit(not result.wasSuccessful())
