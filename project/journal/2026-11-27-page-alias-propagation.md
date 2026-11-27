# Wait for the page and version together

In RL10 production `version.json` served v0.1.100 before the first
HTML read settled. The alias had moved successfully. The one-shot HTML
check held on the legacy release URL. A subsequent direct read returned
the exact new page and Doctor and content readback passed.

QA59 waits on the build in both live documents within the existing
alias budget. Its regression sees the new version beside old HTML and
then beside a wrong release URL. The eventual matching pair passes.
A persistent mismatch still holds the phase.
