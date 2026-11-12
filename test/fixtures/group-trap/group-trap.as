// SENTRY-TRIAGE S3 fixture: a v2 group step that traps on purpose. Signal 1 (`advance`) adds 1 and a random draw to
// `count`; signal 2 (`trap`) runs `unreachable()`, a guest trap; signal 3 (`spin`) loops until the v2 fuel meter traps,
// which is how WILDSHARD-GAME-82's herd module died. Both traps fire after the state and binding opened, mid-call.
import * as core from './sdk/as/wsV2';
let scratch: i32 = 0;
export function ws_abi(): i32 { return 2; }
export function ws_io(): i32 { return 0; }
export function ws_init(lo: i32, hi: i32, fuel: i32): i32 { return fuel; }
export function ws_project(fuel: i32): i32 {
  core.beginState(); assert(core.beginBinding(0));
  const signal = core.parameter(0);
  core.setState(1, signal);
  if (signal == 2) unreachable();
  if (signal == 3) { while (scratch >= 0) scratch++; }
  core.setState(0, core.state(0) + 1 + core.random(1)); core.setState(1, 0);
  core.endBinding(); return fuel;
}
