# Honor the new-test soak before blocking admission

TEST-COVERAGE requires one non-blocking week for a new blocking test.
The new roster file and nightly identity case initially entered blocking
discovery too early. Move roster coverage to an explicitly selected proof
and run both new contracts after CI wall accounting, non-blocking.
Keep every assertion and the production identity fix. Existing nightly
CLI cases retain their blocking invocation; the new case is enabled only
by its explicit report environment. No automatic promotion after a date.

The existing released-save cases retain their established admission.
Their source change fixes inputs and adds no scenario. The first land
was stopped before main so this correction goes with the same batch.
