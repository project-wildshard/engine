// ABI-v0 scene hook. Door ownership stays in declared shared state; the platform projects it to the panel/collider.
export function abi_version(): i32 { return 0; }
export function init(lo: i32, hi: i32): void {}
export function in_ptr(): i32 { return 16384; }
export function in_cap(): i32 { return 4096; }
export function out_ptr(): i32 { return 24576; }
export function out_cap(): i32 { return 1; }
let count: i32 = 0;
let ticks: i32 = 0;
export function out_count(): i32 { return count; }
export function on_tick(): void {
  count = 0; ticks += 1;
  let open = load<f64>(16384 + 64); // first shared field, after state counts
  const events = i32(load<f64>(16384 + 256));
  for (let i = 0; i < events; i++) {
    const at = 16384 + (33 + i * 6) * 8;
    if (load<f64>(at) === 201) { open = 1 - open; count = 1; }
  }
  if (count === 1) {
    store<f64>(24576, 5); store<f64>(24584, 101); store<f64>(24592, open);
    store<f64>(24600, 0); store<f64>(24608, 0);
  }
  store<i32>(30000, ticks); // continuation witness lives outside input/output regions
}
