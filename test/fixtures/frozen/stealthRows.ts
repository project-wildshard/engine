import { frozenAdmissionProgram } from './nalati';

/** Engine-owned row for admission-only stealth preparation tests. */
export const frozenStealthRows = {
  program: frozenAdmissionProgram,
  tuning: {},
  states: ['visible'],
  labels: {},
  panels: { layer: {}, row: {}, grass: {} },
  icons: {},
  disc: 'CROUCH',
  discLabel: 'Crouch',
  threatStates: [],
  hint: '',
  hintSeconds: 0,
  system: 'ci21.frozen.stealth',
  input: { id: 'ci21.frozen.stealth', actions: ['crouch'], keys: {} },
  sneak: { state: 'visible', seconds: 0, multiplier: 1 },
};
