# NM5: an exact parent is outside the author input boundary

The older packaging audit changed caller pins between its paired cooks.
It reported metadata differences and one unexplained Nalati map identity.
The remaining comparison therefore keeps the actual caller pins constant.
It also keeps the installed package's absolute location constant.
Control adds only files the normal package omits, from the same source.
All 2696 retained engine files match before adding that control inventory.
The control adds 3129 files, 215908111 logical bytes, in a private install.
No canonical dependency link or global pnpm-store file is changed.

Both the full control and the untouched trimmed Nalati package fail.
The normal build emits the real product, then refuses its input receipt.
The exact failure is P .. / F ..: Escaped product input: .. .
That refusal occurs independently of the package selection difference.
The classifier excludes ../child but accidentally includes exact .. .
Vite and Node legitimately probe that containing directory during resolution.
Such a probe is outside the declared author input root.

Reproduce it with the actual Vite compiler and real public receipt API.
The original code refuses the complete bundle in 116 milliseconds.
Add exact-parent guards to both ordinary and conservative trace selection.
The existing external-read behavior and conservative fallback remain.
No new cache, source normalization, input exemption or retry is introduced.
Linked paths within the root still refuse as before.
Changing the actual author source still invalidates the captured receipt.
The emitted JavaScript actually executes and exports the expected answer.

The complete quick edge case passes in 283 milliseconds after the guards.
Its focused strict typecheck and root typed lint pass.
The real trimmed Nalati author cook then passes in 70.4 seconds.
It retains all normal declarations, 16 tile windows and zero copy issues.
That whole cook is Ring 2 work, not a newly enlarged quick test.
The permanent regression case is below J186's ten-second limit.

NM3, NM4 and NM7 are already published under rebased source hashes.
They are 1dc4f1c, 5d80504 and 9833799 on the public engine chain.
No already completed dependency migration is built a second time.
NM5 still needs the same-input full/trimmed byte comparison and review.
All optional publications stay local during the v0.1.3 tag window.
The next source publication is handed to codex-j189 with normal gates.
