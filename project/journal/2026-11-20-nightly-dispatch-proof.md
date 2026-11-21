# FS30: on-demand nightly proof

After the cook limit fix, TC22 still read the last scheduled run. A full
production dispatch now supplies the same Ring 2 verdict. The tag hook
reads the newest qualifying run and still holds on a missing, mismatched
or newly red verdict. Staging and diagnostics stay out of the selection.
