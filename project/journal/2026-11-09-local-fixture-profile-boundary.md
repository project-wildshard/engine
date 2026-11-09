# Nested local fixtures do not inherit a push profile

The immutable full gate catches three local product-selection cases after the
strict push preflight fix. All three reproduce under the real authenticated
profile in 1.23 seconds: local-related, all-blocked and local-commit inherit the
parent push marker and therefore correctly receive the stricter push refusal.

The fixture helper now clears the parent's push, CPU admission, broker and slot
markers at its intentionally local subprocess boundary, just as it already
clears the parent's wave inventory addresses. No production refusal changes.
All previous cases retain their original assertions and deadlines. A seventh
actual Vitest mode explicitly reinstalls the push profile and must refuse a
missing product before worker setup. That proves the fix does not turn the
authenticated production push back into the local author skip path.
