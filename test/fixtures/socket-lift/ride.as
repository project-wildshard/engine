export function abi_version(): i32 { return 0; }
export function init(lo: i32, hi: i32): void {}
export function in_ptr(): i32 { return 16384; }
export function in_cap(): i32 { return 4096; }
export function out_ptr(): i32 { return 24576; }
export function out_cap(): i32 { return 4; }
export function out_count(): i32 { return 4; }
@external("env", "query") declare function query(kind: i32, request: i32, response: i32): i32;
@inline function input(i: i32): f64 { return load<f64>(16384 + i * 8); }
@inline function param(i: i32): f64 { return load<f64>(8192 + i * 8); }
@inline function field(slot: i32, id: f64, value: f64): void {
  const out = 24576 + slot * 40;
  store<f64>(out, 1); store<f64>(out + 8, id); store<f64>(out + 16, value); store<f64>(out + 24, 0); store<f64>(out + 32, 0);
}
let topSince: f64 = -1;
export function on_tick(): void {
  if (query(410, 4096, 8192) !== 8) unreachable();
  let progress = input(10), direction = input(11);
  const action = input(2), tick = input(0);
  if (direction === 0) {
    if (action === 1) direction = progress === 0 ? 1 : 0.5;
    else if (action === 2 && progress === 1) direction = 0.5;
    else if (action === 3 && progress === 0) direction = 1;
    if (progress === 1) {
      if (topSince < 0) topSince = tick;
      if (tick - topSince >= 300) direction = 0.5;
    } else topSince = -1;
  }
  if (direction === 1) { progress += input(1) / param(6); if (progress >= 1) { progress = 1; direction = 0; } }
  else if (direction === 0.5) { progress -= input(1) / param(6); if (progress <= 0) { progress = 0; direction = 0; } }
  store<f64>(24576, 4);
  store<f64>(24584, param(0) + (param(3) - param(0)) * progress);
  store<f64>(24592, param(1) + (param(4) - param(1)) * progress);
  store<f64>(24600, param(2) + (param(5) - param(2)) * progress); store<f64>(24608, 0);
  field(1, 4, param(7) === 0 ? 1 : progress > 0 || direction !== 0 ? 1 : 0);
  field(2, 5, progress); field(3, 6, direction);
}
