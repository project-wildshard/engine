# Refusing a different migration chain

When the API reports its migrated copy, the bounded cook child compares the
chain before writing a product. The worker checks the report again before
publishing. Existing and carried indexes must prove the same chain and
digest before they can satisfy a known expectation.

The refusal includes the slug, shard version and both chain IDs. The cook
proof verifies that a mismatch writes nothing and that matching provenance
still cooks the fixture. The golden output is unchanged.
