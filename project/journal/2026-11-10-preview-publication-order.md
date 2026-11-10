# Publish preview assets before validating output

The phone fallback census now validates both inputs and the completed app
publication. The preview wrapper disabled Vite's public copy and supplied
missing public entries only after build-app finished. Its output therefore
failed the strict gate even though its source public files were complete.

Enable Vite's public copy in the preview config. Public files precede the
unchanged output gate; emitted bundle files retain precedence. Keep the
later missing-entry merge for older revisions. This costs a public-tree
copy and storage per preview, now documented instead of claiming no copy.
No asset, runtime code, validator, oracle or deadline changes.

The real ce2e18a preview failed at the post-output gate with copying off.
The forward built the same runtime in 12 s pins + 1 s generation + 24 s
app build, and the output passed all 445 declared image/model checks.
Both real Chromium and WebKit phone loading-card/native-clipboard checks
then passed the unchanged complete timeline/counter oracle with no errors
or external sockets. Owned browsers and the :4400 preview closed normally.

J206 read-only review found no correctness issue; its documentation finding
is fixed in the header. The exact hosted ce2 release-train cycle remains
the independent whole-row proof; this manual preview does not replace it.
