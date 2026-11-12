// SENTRY-TRIAGE S3 fixture: a v2 group step that traps on purpose. Signal 1 adds 1 and a random draw to bank word 0;
// signal 2 runs `unreachable()`, a guest trap; signal 3 loops until the v2 fuel meter traps, which is how
// WILDSHARD-GAME-82's herd module died. Both traps fire after the guest has drawn from the borrowed RNG and written
// bank words, so a host that kept any of it would show. In herd-rows.json signal 2 is the herd's `tick`.
import * as core from './sdk/as/wsV2';
let scratch: i32 = 0;
export function ws_abi(): i32 { return 2; }
export function ws_io(): i32 { return 0; }
export function ws_init(lo: i32, hi: i32, fuel: i32): i32 { return fuel; }
export function ws_project(fuel: i32): i32 {
  core.beginState(); assert(core.beginBinding(0));
  const signal = core.parameter(0), draw = core.random(1);
  core.setState(0, core.state(0) + 1 + draw);
  if (signal == 2) unreachable();
  if (signal == 3) { while (scratch >= 0) scratch++; }
  core.endBinding(); return fuel;
}
