// One admitted module, two explicit item handles. Fixed ABI v0; all actions stay numeric.
export function abi_version(): i32 { return 0; }
export function init(lo: i32, hi: i32): void {}
export function in_ptr(): i32 { return 16384; }
export function in_cap(): i32 { return 4096; }
export function out_ptr(): i32 { return 24576; }
export function out_cap(): i32 { return 1; }
let count: i32 = 0;
export function out_count(): i32 { return count; }
export function on_tick(): void {
  count = 0;
  const action = load<f64>(16384 + 16), entity = load<f64>(16384 + 24);
  const fuel = load<f64>(16384 + 32);
  if ((entity === 1001 && (action === 1 || action === 2)) || (entity === 1002 && ((action === 3 && fuel > 0) || action === 4))) {
    store<f64>(24576, 3); // declared event request
    store<f64>(24584, entity === 1001 ? 101 : 102);
    store<f64>(24592, entity);
    store<f64>(24600, action);
    store<f64>(24608, 0);
    count = 1;
  }
}
