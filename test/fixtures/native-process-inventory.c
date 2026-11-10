/* Darwin's single kernel snapshot, without ps's per-process decoration.
 * Keep every user PID, parent, group and zombie state: cleanup still owns
 * its complete group and transitive descendants, including detached ones. */
#include <sys/types.h>
#include <sys/sysctl.h>
#include <sys/proc.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

int main(void) {
  int mib[] = {CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0};
  size_t size = 0;
  if (sysctl(mib, 4, NULL, &size, NULL, 0) != 0) { perror("native inventory size"); return 1; }
  const size_t extra = 256 * sizeof(struct kinfo_proc);
  if (size > SIZE_MAX - extra) { fputs("native inventory size overflow\n", stderr); return 1; }
  size += extra;
  struct kinfo_proc *rows = malloc(size);
  if (rows == NULL) { perror("native inventory allocation"); return 1; }
  if (sysctl(mib, 4, rows, &size, NULL, 0) != 0) { perror("native inventory snapshot"); free(rows); return 1; }
  if (size % sizeof(*rows) != 0) { fputs("native inventory partial row\n", stderr); free(rows); return 1; }
  for (size_t at = 0; at < size / sizeof(*rows); at++) {
    const struct kinfo_proc *row = &rows[at];
    /* PID 0 is the kernel, never a spawned fixture or a userspace writer. */
    if (row->kp_proc.p_pid == 0) continue;
    char state = '?';
    switch (row->kp_proc.p_stat) {
      case SIDL: state = 'I'; break;
      case SRUN: state = 'R'; break;
      case SSLEEP: state = 'S'; break;
      case SSTOP: state = 'T'; break;
      case SZOMB: state = 'Z'; break;
    }
    printf("%d %d %d %c\n", row->kp_proc.p_pid, row->kp_eproc.e_ppid, row->kp_eproc.e_pgid, state);
  }
  free(rows);
  return ferror(stdout) ? 1 : 0;
}
