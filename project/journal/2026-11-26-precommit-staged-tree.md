# Run pre-commit checks on the staged tree

The commit hook takes its file list and package scripts from Git's index.
It then reuses the push gate's clean-copy machinery for lint, format and
typecheck. A pathspec commit uses the temporary index Git gives its hook.
Engine gives the isolated layered typecheck 45 seconds. Its clean copy
rebuilt the layered cache in 20 seconds during profiling. Lint and
format keep their existing 8-second budgets.

The regression commits staged source beside broken working-tree edits.
It also commits selected paths while a separate broken edit is staged,
then verifies that a later commit of the broken edit is refused.

The pin guard also verifies the outgoing tree selected by main-push when
another lane's commit is on shared main. A real pin push through a bare
remote checks the exact FS18 marker before and under the main-push lock.
