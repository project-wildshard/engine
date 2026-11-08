# Product cooks do not feed the browser build

CI9 separates the actual cook and native step from build and boot. Each
job admits the same pinned Ring 1 catalogue. Build still compiles its own
products and runs the original developer boot group. Cook/step keeps the
same digest update flag and uploads the baseline and actual Linux step
witness from the job that creates them. No witness is synthesized.

The local products/all entry points still execute both halves and retain
red status if either fails. Independent jobs repeat setup; they do not
pretend that setup, the build or browser boot is free. Existing measured
critical path estimates remain 4.8–5.7+ minutes until real runners prove
this exact change. Shell syntax and workflow validation are green only;
hosted product results remain required. Publication is release-held.
