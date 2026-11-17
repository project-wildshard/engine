# Close the queue lifecycle and attribution review findings

The single required read-only review found three MUST fixes. Each got a
native failing regression before repair:

- Killing the outer holder left its detached controller alive. Full-gate
  now watches its original kernel parent and relays the inner controller's
  output through its own pipes. Caller loss drains the inner controller
  before the lease can be released. Land handles SIGHUP and broken output
  pipes, and kills its current Git group if it exits unexpectedly.
- A 45-minute coordination deadline could interrupt a valid multi-round
  land. Full-gate now has no outer command or FIFO deadline; each inner
  gate keeps its existing bound. Scheduler mutex waits remain bounded.
  A command exceeding an artificially tiny --max now succeeds, and its
  default admission deadline is explicitly absent in the active lease.
- Swapping stdout and stderr also promoted sample stdout RED lines.
  Structured stderr causes now take precedence, with stdout as a fallback.
  Actual Git porcelain still decides a genuine remote rejection.

The five repaired native controls pass, including lost holder, delayed
drain, both FL10 stream cases and the command timeout control. The complete
land and stop-cause files pass 89 cases, including killed-waiter admission.
The heavy-lane file passes all nine cases after restoring the existing
virtual-clock diagnostic wording. Together these qualify 98 touched cases.
The prior rebased eight-file cohort passed 139 cases; lint/types are green.
No CPU grant or ancestry check changes.
