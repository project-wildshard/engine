export function developerMode(output: string, udid: string): boolean;
export function connectedDevice(output: string, udid: string): boolean;
export function batteryTemperature(output: string): { celsius: number; raw: number } | null;
export function driverUsesPort(commandLine: string, port: string): boolean;
export function doctor(options?: {
  udid?: string;
  sharedPort?: string;
  run?: (program: string, args: string[]) => { ok: boolean; output: string };
  log?: (line: string) => void;
}): { udid: string; model: string | null; ios: string | null; safari: string | null;
  batteryPercent: number | null; temperature: { celsius: number; raw: number } | null };
export function command(program: string, args: string[]): { ok: boolean; output: string };
