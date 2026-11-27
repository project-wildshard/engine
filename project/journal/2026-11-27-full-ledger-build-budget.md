# Time the images-only full-ledger build

QA66 (J439). Builds 46052321454 and 46056881874 each reached
26m08s. The later job restored the first job's partial cache
across cook 1.18.0. Both added encodes. The encoder keys and
cache prefix match. A full 27-pin preview with a copy of the
warm local cache took 41s after dependency install.

Give the build child 60m within a 65m step and a 75m job. This
also moves the heavy-lane default deadline. The step can still
fail and save partial encodes before the job deadline, and a
successful build has time to archive and upload its artifact.
