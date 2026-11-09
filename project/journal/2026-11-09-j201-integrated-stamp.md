# Integrate the J201 and Git proof identity forwards

The isolated publication view is rebased onto published Doctor main
906dfd51f6d2df39c33b0ec83977861fe73ca1f7.
It carries only the requested cook admission proof and Git SDK proof
identity forwards above that base; intermediate stamp 0f97155 is dropped.
The canonical dirty renderer and validation files are untouched.

Fresh source before this stamp commit is
c0b49eb9b5ef0600eccb0552415c9c6bc04a6887.
Official stamp scripts produce renderer
accb8e4f4783d59c621eada33ec8dccccf06e2b310c8d2f694d21cea8d10f665
and validation
555d2c9b68f9f83bfe48983e3118e39820b65575e5459f46b6beba1662d11482.
Validation is unchanged. The renderer binds the integrated script inputs.
A fresh-process committed-tree recomputation checks both after commit.

The normal commit hook is required. Codex-mock retains the sole enqueue
and full normal gate. No enqueue, suite or browser is started here, and
no obsolete canonical 65/332 stamp chain is imported.
