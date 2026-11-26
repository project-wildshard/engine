#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export function command(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 25_000 });
  return { ok: result.status === 0, output: result.stdout?.trim() ?? '' };
}

const id = (value) => value.toLowerCase().replaceAll('-', '');
const mentions = (line, udid) => id(line).includes(id(udid));

export function developerMode(output, udid) {
  const line = output.split('\n').find((entry) => mentions(entry, udid));
  return line !== undefined && /\b(?:enabled|on|true)\b/iu.test(line) &&
    !/\b(?:disabled|off|false|unsupported|not enabled)\b/iu.test(line);
}

export function connectedDevice(output, udid) {
  const { result } = JSON.parse(output);
  const device = result?.devices?.find((row) => {
    const identifier = row.hardwareProperties?.udid ?? row.properties?.hardware?.udid;
    return typeof identifier === 'string' && id(identifier) === id(udid);
  });
  const connection = device?.connectionProperties ?? device?.properties?.connection;
  return connection?.pairingState === 'paired' && connection.tunnelState === 'connected';
}

export function batteryTemperature(output) {
  const match = /<key>Temperature<\/key>\s*<integer>(\d+)<\/integer>/u.exec(output);
  if (match === null) return null;
  const raw = Number(match[1]);
  if (raw >= 1_000 && raw <= 8_000) return { celsius: raw / 100, raw };
  if (raw >= 100 && raw <= 800) return { celsius: raw / 10, raw };
  return null;
}

/** @param {string} commandLine @param {string} port */
export function driverUsesPort(commandLine, port) {
  const args = commandLine.trim().split(/\s+/u);
  return args[0]?.split('/').at(-1) === 'safaridriver' &&
    args.some((arg, i) => ((arg === '-p' || arg === '--port') && args[i + 1] === port) || arg === `--port=${port}`);
}

export function doctor({ udid: requestedUdid, sharedPort, run = command, log = console.log } = {}) {
  function check(name, passed, help) {
    if (!passed) throw new Error(`${name}: ${help}`);
    log(`ok ${name}`);
  }
  const usb = run('idevice_id', ['-l']);
  const ids = usb.output.split(/\s+/u).filter(Boolean);
  const udid = requestedUdid ?? (ids.length === 1 ? ids[0] : undefined);
  check('usbmux', usb.ok && udid !== undefined && ids.some((entry) => id(entry) === id(udid)),
    ids.length > 1 ? 'select an attached phone with --udid' : 'plug in and unlock the iPhone');
  const usbArgs = ['-u', udid];
  check('pairing', run('idevicepair', [...usbArgs, 'validate']).ok, 'unlock the iPhone and trust this Mac');
  const devMode = run('devmodectl', ['list']);
  check('Developer Mode', devMode.ok && developerMode(devMode.output, udid), 'enable Developer Mode on the iPhone');
  const coreDevice = run('xcrun', ['devicectl', 'list', 'devices', '--json-output', '-']);
  check('CoreDevice', coreDevice.ok && connectedDevice(coreDevice.output, udid),
    'device offline. Run sudo killall remotepairingd and replug the cable');
  const xctrace = run('xcrun', ['xctrace', 'list', 'devices']);
  const physical = xctrace.output.split('== Simulators ==')[0];
  check('xctrace', xctrace.ok && physical.split('\n').some((line) => mentions(line, udid)), 'the iPhone is missing from Instruments');
  check('safaridriver', run('safaridriver', ['--version']).ok, 'install Safari and enable Remote Automation');

  const drivers = run('pgrep', ['-x', 'safaridriver']).output.split(/\s+/u).filter(Boolean);
  // On the mini, lsof does not expose the Safari driver's listener. Match
  // the exact process and its explicit port argument after the handoff.
  const foreign = drivers.filter((pid) => sharedPort === undefined ||
    !driverUsesPort(run('ps', ['-p', pid, '-o', 'command=']).output, sharedPort));
  check('Safari driver ownership', foreign.length === 0, `foreign safaridriver PID ${foreign.join(', ')}. Wait for its owner`);

  const info = (key) => {
    const { output } = run('ideviceinfo', [...usbArgs, '-k', key]);
    return output === '' ? null : output;
  };
  const battery = run('ideviceinfo', [...usbArgs, '-q', 'com.apple.mobile.battery', '-k', 'BatteryCurrentCapacity']);
  const level = battery.ok && /^\d{1,3}$/u.test(battery.output) && Number(battery.output) <= 100 ?
    Number(battery.output) : null;
  const batteryState = run('idevicediagnostics', [...usbArgs, 'ioregentry', 'AppleSmartBattery']);
  const apps = run('xcrun', ['devicectl', 'device', 'info', 'apps', '--device', udid, '--include-default-apps',
    '--filter', "bundleIdentifier == 'com.apple.mobilesafari'", '--json-output', '-']);
  const safari = apps.ok ? JSON.parse(apps.output).result?.apps?.[0] : null;
  const facts = {
    udid, model: info('ProductType'), ios: info('ProductVersion'),
    safari: safari?.version ?? safari?.shortVersion ?? null,
    batteryPercent: level, temperature: batteryTemperature(batteryState.output),
  };
  log(JSON.stringify(facts));
  return facts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { udid: { type: 'string' }, 'shared-port': { type: 'string' } } });
    doctor({ udid: values.udid, sharedPort: values['shared-port'] });
  } catch (error) {
    console.error(`phone doctor: ${error.message}`);
    process.exitCode = 1;
  }
}
