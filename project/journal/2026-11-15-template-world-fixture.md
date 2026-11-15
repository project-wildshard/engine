# One seated world per Template test worker

Template 1 specs share a worker-scoped page and its real standalone world.
The fixture enters through title and Shard select, identifying the pinned
Template by slug rather than its mutable display name. New-save tests use
freshPage, which creates and later disposes a separate browser context.

The fixture proof checks reuse across two tests and isolation from a new
seated page. Contexts close even when entry or a test fails. Desktop play
uses the explicit 30 fps cap while the laptop is shared.
