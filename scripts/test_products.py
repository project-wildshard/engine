"""Batch/CI disk-product dependencies; never run at live pre-push."""
import re


def required_test_products(tests, registry):
    """Explicit disk-product edges, including tests whose imports cannot name them."""
    products = set()
    for test in tests:
        if re.fullmatch(r'test/scripts/[^/]+\.test\.ts', test) and test not in registry:
            raise ValueError('Register disk scenario products before gating: ' + test)
        products.update(registry.get(test, []))
    return sorted(products)


def custom_sections_zero_command(tree):
    """Only the immutable carrier's checker can vouch for its products."""
    guard = tree / 'scripts/check-custom-sections-zero.mjs'
    if not guard.is_file():
        raise ValueError('Missing zero custom-section guard')
    return ['node', str(guard), str(tree)]
