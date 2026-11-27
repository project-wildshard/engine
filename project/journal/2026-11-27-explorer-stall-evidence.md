# Keep Explorer stall evidence in the nightly

Starfall's WebKit Explorer phase stalled in run `46000160457`. The
receipt had zero cards and zero pending requests. It omitted completed
requests, and the head runner discarded the existing screenshot. The
same upload and engine passed locally, so the cause remains unknown.

QA53 keeps the HTTP tail, catalogue requests, last observed catalogue
state and failure screenshot or capture error. The original progress
deadline still holds. The bounded evidence collection begins once the
sweep has refused. The regression freezes both kinds of renderer reads
and checks that the receipt carries completed, pending and failed work.
