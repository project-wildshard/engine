// TEST-SPEED TS5: the open-plot routes run in three files so none passes 30 s hosted (one file was 42-49 s).
// Each plot still keeps its one native resident through its entry and plaza walk. Plots named here run in
// physics-open-plots-headless-2/-3.test.ts; every other open plot, including any new one, runs in the original file.
export const OPEN_PLOTS_2:ReadonlySet<string>=new Set(['open-plot-patchwork-fairground','open-plot-desert-ruin','open-plot-sky-harbor',
  'open-plot-starfall-observatory','open-plot-thin-ice','open-plot-clockwork-canyon']);
export const OPEN_PLOTS_3:ReadonlySet<string>=new Set(['open-plot-saltwind-lighthouse','open-plot-jungle-ziggurat','open-plot-sky-race',
  'open-plot-alien-plain','open-plot-showcase-template']);
