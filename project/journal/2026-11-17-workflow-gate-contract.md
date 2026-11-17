# Let the workflow own its complete gate set

J389/J400: the new nine-ring1 proof exposed a brittle test assertion.
The existing J400 contract fails first because it enumerates every job
and forbids any dependency on products anywhere in the workflow.

Keep Nine's jobs and dependencies untouched. Check only the required
packed execution roles and T1's producer placement. Additional jobs,
including failure policy, belong to the workflow. Land already uses the
whole workflow conclusion. A real-Git control proves a newly named
independent failing gate refuses a hosted fallback land without any
job-name allowlist. Merge the mini's simultaneous named-Nine exception
into this general rule instead of retaining another exhaustive list.
