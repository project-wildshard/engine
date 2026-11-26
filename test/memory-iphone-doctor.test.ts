import { expect, test } from 'vitest';
import { batteryTemperature, connectedDevice, developerMode, doctor, driverUsesPort } from '../src/scripts/memory/iphone/doctor.mjs';

const phone = '00000000-0000000000000000';

test('the first unavailable device check stops the doctor', () => {
  const programs: string[] = [];
  expect(() => doctor({ run: (program) => {
    programs.push(program);
    return { ok: true, output: '' };
  } })).toThrow('usbmux');
  expect(programs).toEqual(['idevice_id']);
});

test('Developer Mode is scoped to the selected USB device', () => {
  expect(developerMode(`another-phone enabled\n${phone} disabled`, phone)).toBe(false);
  // Captured devmodectl columns from iOS 18.6.2, with the USB identifier redacted.
  expect(developerMode(`UDID\t\t\t\tDeveloper Mode Status\n${phone}\tenabled`, phone)).toBe(true);
});

test('CoreDevice identifies the phone and requires a usable connection', () => {
  const record = (pairingState: string, tunnelState: string) =>
    JSON.stringify({ result: { devices: [{ hardwareProperties: { udid: phone },
      connectionProperties: { pairingState, tunnelState, transportType: 'wired' } }] } });
  expect(connectedDevice(record('paired', 'connected'), phone)).toBe(true);
  expect(connectedDevice(record('unsupported', 'unavailable'), phone)).toBe(false);
});

test('the battery reading reports the original temperature units alongside Celsius', () => {
  expect(batteryTemperature('<key>Temperature</key>\n\t\t<integer>3529</integer>')).toEqual({ celsius: 35.29, raw: 3529 });
  expect(batteryTemperature('<key>Temperature</key><integer>0</integer>')).toBeNull();
});

test('the doctor permits only the Safari driver on the handed-off port', () => {
  expect(driverUsesPort('safaridriver -p 4444', '4444')).toBe(true);
  expect(driverUsesPort('safaridriver -p 44440', '4444')).toBe(false);
  expect(driverUsesPort('sh safaridriver -p 4444', '4444')).toBe(false);
});
